import { Controller, Get, Query } from '@nestjs/common';
import { dashboardSchema, dateRangeSchema } from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';

import { DashboardQuery } from '../../domains/ledger/queries/dashboard.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * The admin home: money cards, queue counts and ledger health for an IST date range. The money
 * comes from the same ledger aggregate as `GET admin/finance/balances`, so the two cannot differ.
 */
@Controller('admin/dashboard')
@Roles(Role.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardQuery) {}

  @Get()
  async read(@Query() query: unknown) {
    const { from, to } = dateRangeSchema.parse(query ?? {});
    return parseOutgoing(dashboardSchema, await this.dashboard.read(from, to), 'admin dashboard');
  }
}
