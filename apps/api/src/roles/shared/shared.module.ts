import { Module } from '@nestjs/common';

import { IdentityModule } from '../../domains/identity/identity.module.js';
import { StorageModule } from '../../platform/storage/storage.module.js';

import { MeController } from './me.controller.js';

@Module({
  imports: [IdentityModule, StorageModule],
  controllers: [MeController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SharedModule {}
