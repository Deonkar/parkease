import { Module } from '@nestjs/common';

import { CloudinaryService } from './cloudinary.service.js';

@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StorageModule {}
