import { Controller, Get } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { type OwnerDashboard, ownerDashboardSchema } from '@parkease/contracts/owner';

import { OwnerDashboardQuery } from '../../domains/ledger/queries/owner-dashboard.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toStatementLine } from './views/earnings.view.js';

@Controller('owner/dashboard')
@Roles(Role.OWNER)
export class OwnerDashboardController {
  constructor(private readonly dashboard: OwnerDashboardQuery) {}

  @Get()
  async show(@CurrentUser() user: AuthUser): Promise<OwnerDashboard> {
    const data = await this.dashboard.forOwner(user.id);
    return parseOutgoing(
      ownerDashboardSchema,
      { ...data, statement: data.statement.map(toStatementLine) },
      'owner dashboard',
    );
  }
}
