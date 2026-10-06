import { Module } from '@nestjs/common';

import { SpaceModule } from '../space/space.module.js';

import { LedgerService } from './ledger.service.js';
import { FinanceBalancesQuery } from './queries/account-totals.js';
import { DashboardQuery } from './queries/dashboard.js';
import { LedgerExplorerQuery } from './queries/ledger-explorer.js';
import { LedgerExportStream } from './queries/ledger-export.js';
import { OwnerBalanceQuery } from './queries/owner-balance.js';
import { OwnerDashboardQuery } from './queries/owner-dashboard.js';

@Module({
  imports: [SpaceModule],
  providers: [
    LedgerService,
    OwnerBalanceQuery,
    OwnerDashboardQuery,
    FinanceBalancesQuery,
    DashboardQuery,
    LedgerExplorerQuery,
    LedgerExportStream,
  ],
  exports: [
    LedgerService,
    OwnerBalanceQuery,
    OwnerDashboardQuery,
    FinanceBalancesQuery,
    DashboardQuery,
    LedgerExplorerQuery,
    LedgerExportStream,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LedgerModule {}
