import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PublicModule {}
