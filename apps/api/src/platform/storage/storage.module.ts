import { Global, Module } from '@nestjs/common';

import { CloudinaryService } from './cloudinary.service.js';
import { UploadRegistry } from './upload-registry.js';

/** Global: every role that attaches an upload checks it against the registry (S-50). */
@Global()
@Module({
  providers: [CloudinaryService, UploadRegistry],
  exports: [CloudinaryService, UploadRegistry],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StorageModule {}
