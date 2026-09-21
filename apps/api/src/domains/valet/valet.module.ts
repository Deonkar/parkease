import { Module } from '@nestjs/common';

import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { AssignmentService } from './assignment.service.js';
import { AcceptJobCommand } from './commands/accept-job.command.js';
import { AdvanceJobCommand } from './commands/advance-job.command.js';
import { CancelJobCommand } from './commands/cancel-job.command.js';
import { RequestReturnCommand } from './commands/request-return.command.js';
import { RequestValetCommand } from './commands/request-valet.command.js';
import { SetAvailabilityCommand } from './commands/set-availability.command.js';
import { LocationService } from './location.service.js';
import { ValetEarningsQuery } from './queries/valet-earnings.query.js';
import { ValetService } from './valet.service.js';

const PROVIDERS = [
  ValetService,
  AssignmentService,
  LocationService,
  ValetEarningsQuery,
  RequestValetCommand,
  AcceptJobCommand,
  AdvanceJobCommand,
  RequestReturnCommand,
  CancelJobCommand,
  SetAvailabilityCommand,
];

@Module({
  imports: [LedgerModule, OutboxModule],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ValetModule {}
