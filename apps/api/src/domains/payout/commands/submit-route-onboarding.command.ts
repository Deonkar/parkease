import { Inject, Injectable } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import type { SubmitRouteOnboarding } from '@parkease/contracts/shared';
import { routeOnboardingClaims } from '@parkease/db/schema';
import { and, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { logger } from '../../../platform/observability/logger.js';
import { CommissionWaiverService } from '../../pricing/commission-waiver.service.js';
import {
  PayoutProviderUnavailableError,
  RouteDetailsRejectedError,
  RouteOnboardingInProgressError,
  RouteOnboardingLockedError,
} from '../errors.js';
import { type LinkedAccountRow, PayoutService } from '../payout.service.js';
import { RazorpayApiError } from '../razorpay-rest.js';
import { ROUTE, type RouteClient } from '../route.client.js';

/** Razorpay's business categories (Route integration guide), fixed per role. */
const PROFILE = {
  [Role.OWNER]: { category: 'transport', subcategory: 'parking_lots_and_garages' },
  [Role.WASHER]: { category: 'services', subcategory: 'car_washes' },
} as const;

/** Only these may (re)submit: not started, stopped part-way, or asked to correct something. */
const OPEN = new Set(['pending', 'needs_clarification']);

type Step = 'account' | 'stakeholder' | 'product' | 'settlement';

export interface SubmitRouteOnboardingInput {
  readonly userId: string;
  readonly role: typeof Role.OWNER | typeof Role.WASHER;
  readonly form: SubmitRouteOnboarding;
}

/**
 * Creates (or corrects) the payee's Route Linked Account (task 16b, ADR-013/030).
 *
 * Four Razorpay calls, none inside a transaction (rule 4), each id saved before the next, so
 * a failure part-way resumes on the next submit instead of creating a second account. A
 * resubmission after `needs_clarification` PATCHes what exists. The PAN and the account
 * number are sent to Razorpay and never written here: only the display fields are, and only
 * once Razorpay has accepted the bank account they describe. The status goes through the
 * webhooks' ordered write and yields to any webhook newer than the settlement call, so an
 * `activated` that lands first is never undone by this response.
 */
/**
 * How long a submit's claim holds before another may take it over: four Razorpay calls at
 * `GATEWAY_TIMEOUT_MS` each, with room to spare. Only a crashed submit is ever that old.
 */
export const ROUTE_ONBOARDING_CLAIM_TTL_MS = 2 * 60_000;

@Injectable()
export class SubmitRouteOnboardingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ROUTE) private readonly route: RouteClient,
    private readonly payouts: PayoutService,
    private readonly waivers: CommissionWaiverService,
  ) {}

  async execute(input: SubmitRouteOnboardingInput): Promise<LinkedAccountRow> {
    // One submit per user talks to Razorpay at a time (S-112): two that both found no linked
    // account would each create one, and the second would orphan the first.
    const claimedAt = await this.claim(input.userId);
    try {
      return await this.submit(input);
    } finally {
      await this.db
        .delete(routeOnboardingClaims)
        .where(
          and(
            eq(routeOnboardingClaims.userId, input.userId),
            eq(routeOnboardingClaims.claimedAt, claimedAt),
          ),
        );
    }
  }

  /** Takes the user's claim, or a claim abandoned past its TTL; throws while one is live. */
  private async claim(userId: string): Promise<Date> {
    const [claimed] = await this.db
      .insert(routeOnboardingClaims)
      // Millisecond precision, so the JS Date read back matches the row exactly on release.
      .values({ userId, claimedAt: sql`date_trunc('milliseconds', now())` })
      .onConflictDoUpdate({
        target: routeOnboardingClaims.userId,
        set: { claimedAt: sql`date_trunc('milliseconds', now())`, updatedAt: sql`now()` },
        setWhere: sql`${routeOnboardingClaims.claimedAt} < now() - make_interval(secs => ${ROUTE_ONBOARDING_CLAIM_TTL_MS / 1000})`,
      })
      .returning({ claimedAt: routeOnboardingClaims.claimedAt });
    if (claimed === undefined) throw new RouteOnboardingInProgressError();
    return claimed.claimedAt;
  }

  private async submit(input: SubmitRouteOnboardingInput): Promise<LinkedAccountRow> {
    const { userId, form } = input;
    const existing = await this.payouts.linkedFor(userId);
    if (existing !== undefined && !OPEN.has(existing.kycStatus)) {
      throw new RouteOnboardingLockedError();
    }

    let step: Step = 'account';
    try {
      const accountId = await this.route.upsertAccount(existing?.razorpayAccountId ?? null, {
        email: form.email,
        phone: (await this.payouts.phoneOf(userId)).replace(/\D/g, ''),
        legalName: form.legalName,
        ...PROFILE[input.role],
        street: form.street,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        referenceId: userId,
      });
      await this.payouts.saveLinked(userId, accountId, {});

      step = 'stakeholder';
      const stakeholderId = await this.route.upsertStakeholder(
        accountId,
        existing?.razorpayStakeholderId ?? null,
        { name: form.legalName, email: form.email, pan: form.pan },
      );
      await this.payouts.saveLinked(userId, accountId, { razorpayStakeholderId: stakeholderId });

      step = 'product';
      const productId = existing?.razorpayProductId ?? (await this.route.requestProduct(accountId));
      await this.payouts.saveLinked(userId, accountId, { razorpayProductId: productId });

      step = 'settlement';
      // Floored to Razorpay's whole seconds, so a webhook from this second on wins.
      const sentAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      const settled = await this.route.configureSettlement(accountId, productId, {
        accountNumber: form.accountNumber,
        ifsc: form.ifsc,
        beneficiaryName: form.legalName,
      });
      const saved = await this.payouts.saveLinked(userId, accountId, {
        legalName: form.legalName,
        settlementLast4: form.accountNumber.slice(-4),
        settlementIfscPrefix: form.ifsc.slice(0, 4),
      });
      await withTransaction(this.db, async (tx) => {
        const result = await this.payouts.applyRouteStatus(
          tx,
          { userId },
          {
            status: settled.status,
            requirements: settled.requirements,
            at: sentAt,
            stamp: false,
          },
        );
        // Razorpay can answer `activated` straight away; the grant must not wait for a webhook.
        if (
          result.outcome === 'applied' &&
          settled.status === 'activated' &&
          result.previous !== 'activated'
        ) {
          await this.waivers.grantIfEligible(tx, userId);
        }
      });
      return (await this.payouts.linkedFor(userId)) ?? saved;
    } catch (error) {
      if (!(error instanceof RazorpayApiError)) throw error;
      // The step, status and message only: the message names the path and Razorpay's status,
      // never the request, which carried a PAN and an account number.
      logger.warn(
        { userId, step, status: error.status, reason: error.message },
        'route onboarding step refused or failed',
      );
      throw error.rejected ? new RouteDetailsRejectedError() : new PayoutProviderUnavailableError();
    }
  }
}
