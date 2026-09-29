import { Inject, Injectable } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import type { SubmitRouteOnboarding } from '@parkease/contracts/shared';

import { logger } from '../../../platform/observability/logger.js';
import {
  PayoutProviderUnavailableError,
  RouteDetailsRejectedError,
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
 * number are sent to Razorpay and never written here: only the display fields are.
 */
@Injectable()
export class SubmitRouteOnboardingCommand {
  constructor(
    @Inject(ROUTE) private readonly route: RouteClient,
    private readonly payouts: PayoutService,
  ) {}

  async execute(input: SubmitRouteOnboardingInput): Promise<LinkedAccountRow> {
    const { userId, form } = input;
    const existing = await this.payouts.linkedFor(userId);
    if (existing !== undefined && !OPEN.has(existing.kycStatus)) {
      throw new RouteOnboardingLockedError();
    }
    const display = {
      legalName: form.legalName,
      settlementLast4: form.accountNumber.slice(-4),
      settlementIfscPrefix: form.ifsc.slice(0, 4),
    };

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
      await this.payouts.saveLinked(userId, accountId, { kycStatus: 'pending', ...display });

      const stakeholderId = await this.route.upsertStakeholder(
        accountId,
        existing?.razorpayStakeholderId ?? null,
        { name: form.legalName, email: form.email, pan: form.pan },
      );
      await this.payouts.saveLinked(userId, accountId, { razorpayStakeholderId: stakeholderId });

      const productId = existing?.razorpayProductId ?? (await this.route.requestProduct(accountId));
      await this.payouts.saveLinked(userId, accountId, { razorpayProductId: productId });

      const settled = await this.route.configureSettlement(accountId, productId, {
        accountNumber: form.accountNumber,
        ifsc: form.ifsc,
        beneficiaryName: form.legalName,
      });
      return await this.payouts.saveLinked(userId, accountId, {
        kycStatus: settled.status,
        requirements: settled.requirements,
      });
    } catch (error) {
      if (!(error instanceof RazorpayApiError)) throw error;
      // The user id and status only: the request carried a PAN and an account number.
      logger.warn({ userId, status: error.status }, 'route onboarding step refused or failed');
      throw error.rejected ? new RouteDetailsRejectedError() : new PayoutProviderUnavailableError();
    }
  }
}
