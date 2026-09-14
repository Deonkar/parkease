import { Module } from '@nestjs/common';

import { SpaceModule } from '../../domains/space/space.module.js';

import { OwnerSpacesController } from './spaces.controller.js';

@Module({
  imports: [SpaceModule],
  controllers: [OwnerSpacesController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OwnerModule {}
