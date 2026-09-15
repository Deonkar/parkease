import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service.js';

@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LedgerModule {}
