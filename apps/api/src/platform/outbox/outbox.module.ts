import { Global, Module } from '@nestjs/common';

import { OutboxLagQuery } from './outbox-lag.query.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({
  providers: [OutboxService, OutboxLagQuery],
  exports: [OutboxService, OutboxLagQuery],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OutboxModule {}
