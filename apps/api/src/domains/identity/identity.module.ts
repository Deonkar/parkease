import { Module } from '@nestjs/common';

import { CreateSessionCommand } from './commands/create-session.command.js';
import { SwitchRoleCommand } from './commands/switch-role.command.js';
import { RoleRepository } from './repositories/role.repository.js';
import { UserRepository } from './repositories/user.repository.js';

@Module({
  providers: [CreateSessionCommand, SwitchRoleCommand, UserRepository, RoleRepository],
  exports: [CreateSessionCommand, SwitchRoleCommand, UserRepository, RoleRepository],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class IdentityModule {}
