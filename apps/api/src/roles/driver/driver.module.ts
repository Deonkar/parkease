import { Module } from '@nestjs/common';

import { SpaceModule } from '../../domains/space/space.module.js';

import { DriverSearchController } from './search.controller.js';

@Module({
  imports: [SpaceModule],
  controllers: [DriverSearchController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DriverModule {}
