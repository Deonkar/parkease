import { Module } from '@nestjs/common';

import { PublicModule } from './roles/public/public.module.js';

@Module({
  imports: [PublicModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
