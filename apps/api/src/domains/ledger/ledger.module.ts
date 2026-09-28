import { Module } from '@nestjs/common';

import { SpaceModule } from '../space/space.module.js';

import { LedgerService } from './ledger.service.js';
import { OwnerBalanceQuery } from './queries/owner-balance.js';
import { OwnerDashboardQuery } from './queries/owner-dashboard.js';

@Module({
  imports: [SpaceModule],
  providers: [LedgerService, OwnerBalanceQuery, OwnerDashboardQuery],
  exports: [LedgerService, OwnerBalanceQuery, OwnerDashboardQuery],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LedgerModule {}
