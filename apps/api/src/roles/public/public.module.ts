import { Module } from '@nestjs/common';

import { IdentityModule } from '../../domains/identity/identity.module.js';

import { AuthController } from './auth.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [HealthController, AuthController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PublicModule {}
