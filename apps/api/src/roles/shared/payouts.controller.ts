import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { MINIMUM_PAYOUT_PAISE, nextPayoutOn } from '@parkease/contracts/money';
import { payoutIdSchema } from '@parkease/contracts/primitives';
import {
  type BankDetailsView,
  payoutListQuerySchema,
  payoutPageSchema,
  type PayoutSummaryView,
  payoutSummaryViewSchema,
  type PayoutView,
  updateBankDetailsSchema,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { UpsertBankDetailsCommand } from '../../domains/payout/commands/upsert-bank-details.command.js';
import { BankDetailsNotFoundError, PayoutNotFoundError } from '../../domains/payout/errors.js';
import { PayoutService } from '../../domains/payout/payout.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { ReauthService } from '../../platform/auth/reauth.service.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toBankDetailsView, toPayoutView } from './views/payout.view.js';

const payoutParamsSchema = z.object({ id: payoutIdSchema });

/**
 * Bank details and payout history for everyone we pay. Under `/me` rather than
 * `/owner` (§16.11): RazorpayX pays valets, and washers and owners need the
 * same screen (ADR-030). Every read is scoped to the caller.
 */
@Controller('me')
@Roles(Role.OWNER, Role.VALET, Role.WASHER)
export class MePayoutsController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly upsert: UpsertBankDetailsCommand,
    private readonly reauth: ReauthService,
  ) {}

  @Put('bank-details')
  async updateBankDetails(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<BankDetailsView> {
    const { reauthToken, ...details } = updateBankDetailsSchema.parse(body);
    // Where money goes changes only for someone holding the phone now (S-100).
    await this.reauth.assertFresh(user.id, reauthToken);
    const row = await this.upsert.execute({ userId: user.id, role: user.activeRole, details });
    return toBankDetailsView(row);
  }

  @Get('bank-details')
  async bankDetails(@CurrentUser() user: AuthUser): Promise<BankDetailsView> {
    const row = await this.payouts.bankFor(user.id);
    if (row === undefined) throw new BankDetailsNotFoundError();
    return toBankDetailsView(row);
  }

  /** Valets only: RazorpayX pays them weekly; Route pays owners and washers per booking. */
  @Get('payouts/summary')
  @Roles(Role.VALET)
  async summary(@CurrentUser() user: AuthUser): Promise<PayoutSummaryView> {
    return parseOutgoing(
      payoutSummaryViewSchema,
      {
        balancePaise: await this.payouts.payableBalance(user.id),
        nextPayoutOn: nextPayoutOn(new Date()),
        minimumPaise: MINIMUM_PAYOUT_PAISE,
      },
      'payout summary',
    );
  }

  @Get('payouts')
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = payoutListQuerySchema.parse(query ?? {});
    const page = await this.payouts.list(user.id, {
      limit: q.limit,
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
    });
    return parseOutgoing(
      payoutPageSchema,
      {
        items: page.items.map(toPayoutView),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'payout history page',
    );
  }

  @Get('payouts/:id')
  async one(@CurrentUser() user: AuthUser, @Param() params: unknown): Promise<PayoutView> {
    const { id } = payoutParamsSchema.parse(params);
    const row = await this.payouts.byId(user.id, id);
    if (row === undefined) throw new PayoutNotFoundError();
    return toPayoutView(row);
  }
}
