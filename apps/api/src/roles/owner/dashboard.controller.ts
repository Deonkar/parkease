import { Controller, Get } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { istDateOf } from '@parkease/contracts/money';
import { type OwnerDashboard, ownerDashboardSchema } from '@parkease/contracts/owner';

import { OwnerDashboardQuery } from '../../domains/ledger/queries/owner-dashboard.js';
import { CommissionWaiverService } from '../../domains/pricing/commission-waiver.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toStatementLine } from './views/earnings.view.js';

@Controller('owner/dashboard')
@Roles(Role.OWNER)
export class OwnerDashboardController {
  constructor(
    private readonly dashboard: OwnerDashboardQuery,
    private readonly waivers: CommissionWaiverService,
  ) {}

  @Get()
  async show(@CurrentUser() user: AuthUser): Promise<OwnerDashboard> {
    const [data, waiver] = await Promise.all([
      this.dashboard.forOwner(user.id),
      this.waivers.activeFor(user.id, new Date()),
    ]);
    return parseOutgoing(
      ownerDashboardSchema,
      {
        ...data,
        statement: data.statement.map(toStatementLine),
        commissionWaiver: waiver === null ? null : { endsOn: istDateOf(waiver.endsAt) },
      },
      'owner dashboard',
    );
  }
}
