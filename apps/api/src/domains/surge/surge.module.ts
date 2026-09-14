import { Module } from '@nestjs/common';

import { SurgeService } from './surge.service.js';

@Module({
  providers: [SurgeService],
  exports: [SurgeService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SurgeModule {}
