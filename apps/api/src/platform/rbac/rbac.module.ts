import { Module } from '@nestjs/common';

import { ActiveRoleGuard } from './active-role.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  providers: [RolesGuard, ActiveRoleGuard],
  exports: [RolesGuard, ActiveRoleGuard],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RbacModule {}
