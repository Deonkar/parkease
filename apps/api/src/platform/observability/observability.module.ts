import { Global, Module } from '@nestjs/common';

import { AuditQueries } from './audit.queries.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService, AuditQueries],
  exports: [AuditService, AuditQueries],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ObservabilityModule {}
