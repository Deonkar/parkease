import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  type OwnerEarningsView,
  ownerEarningsQuerySchema,
  ownerTransactionsQuerySchema,
  statementLineSchema,
} from '@parkease/contracts/owner';
import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { OwnerBalanceQuery } from '../../domains/ledger/queries/owner-balance.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toEarningsView, toStatementLine } from './views/earnings.view.js';

const transactionsPageSchema = z.object({
  items: z.array(statementLineSchema),
  meta: cursorPageMetaSchema,
});

/** Answered from the ledger and nothing else (R-MONEY-05). */
@Controller('owner/earnings')
@Roles(Role.OWNER)
export class OwnerEarningsController {
  constructor(private readonly earnings: OwnerBalanceQuery) {}

  @Get()
  async summary(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<OwnerEarningsView> {
    const { period } = ownerEarningsQuerySchema.parse(query ?? {});
    const movement = await this.earnings.movementForPeriod(user.id, period);
    const bookings = await this.earnings.statementCount(user.id, period);
    const days = await this.earnings.days(user.id, period);
    return toEarningsView(period, movement, bookings, days);
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = ownerTransactionsQuerySchema.parse(query ?? {});
    const page = await this.earnings.statementPage(user.id, {
      period: q.period,
      limit: q.limit,
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
    });
    return parseOutgoing(
      transactionsPageSchema,
      {
        items: page.items.map(toStatementLine),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'owner transactions page',
    );
  }
}
