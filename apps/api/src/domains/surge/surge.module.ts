import { Module } from '@nestjs/common';

import { SurgeAdminService } from './surge-admin.service.js';
import { SurgeService } from './surge.service.js';

@Module({
  providers: [SurgeService, SurgeAdminService],
  exports: [SurgeService, SurgeAdminService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SurgeModule {}
