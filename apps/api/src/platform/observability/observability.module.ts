import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ObservabilityModule {}
