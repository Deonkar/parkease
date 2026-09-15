import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service.js';
import { OwnerBalanceQuery } from './queries/owner-balance.js';

@Module({
  providers: [LedgerService, OwnerBalanceQuery],
  exports: [LedgerService, OwnerBalanceQuery],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LedgerModule {}
