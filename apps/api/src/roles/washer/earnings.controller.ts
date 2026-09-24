import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { washerEarningsQuerySchema, type WasherEarningsView } from '@parkease/contracts/washer';

import { WasherEarningsQuery } from '../../domains/carwash/queries/washer-earnings.query.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('washer/earnings')
@Roles(Role.WASHER)
export class WasherEarningsController {
  constructor(private readonly earnings: WasherEarningsQuery) {}

  /**
   * Answered from the ledger and nothing else (R-MONEY-05).
   *
   * There is a test that asserts this endpoint returns the same number as a
   * direct `owner_payable` balance query for the same counterparty, so the API
   * cannot drift from the books without turning it red.
   */
  @Get()
  async summary(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<WasherEarningsView> {
    const { period } = washerEarningsQuerySchema.parse(query ?? {});
    return this.earnings.forWasher(user.id, period);
  }
}
