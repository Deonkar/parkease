import { Module } from '@nestjs/common';

import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { UpsertBankDetailsCommand } from './commands/upsert-bank-details.command.js';
import { PayoutService } from './payout.service.js';
import { RAZORPAYX, RazorpayXHttpClient } from './razorpayx.client.js';

/**
 * Bank details and payout reads (task 16a). Executing a payout is the worker's
 * job (`jobs/payout/`), not an endpoint: nobody can trigger one by hand.
 */
@Module({
  imports: [LedgerModule, OutboxModule],
  providers: [
    PayoutService,
    UpsertBankDetailsCommand,
    { provide: RAZORPAYX, useClass: RazorpayXHttpClient },
  ],
  exports: [PayoutService, UpsertBankDetailsCommand],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PayoutModule {}
