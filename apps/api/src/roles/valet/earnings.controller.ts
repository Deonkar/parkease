import { Controller, Get } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import type { ValetEarningsSummary } from '@parkease/contracts/valet';

import { ValetEarningsQuery } from '../../domains/valet/queries/valet-earnings.query.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('valet/earnings')
@Roles(Role.VALET)
export class ValetEarningsController {
  constructor(private readonly earnings: ValetEarningsQuery) {}

  /**
   * Answered from the ledger and nothing else (R-MONEY-05).
   *
   * There is a test that asserts this endpoint returns the same number as a
   * direct `owner_payable` balance query for the same counterparty, so the API
   * cannot drift from the books without turning it red.
   */
  @Get()
  async summary(@CurrentUser() user: AuthUser): Promise<ValetEarningsSummary> {
    return this.earnings.forValet(user.id);
  }
}
