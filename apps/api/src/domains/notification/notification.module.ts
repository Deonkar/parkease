import { Module } from '@nestjs/common';

import { NotificationService } from './notification.service.js';

@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NotificationModule {}
