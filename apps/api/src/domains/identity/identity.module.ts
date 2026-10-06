import { Module } from '@nestjs/common';

import { AdminUserQueries } from './admin-user.queries.js';
import { CreateSessionCommand } from './commands/create-session.command.js';
import { GrantRoleCommand } from './commands/grant-role.command.js';
import { ReviewPartnerCommand } from './commands/review-partner.command.js';
import { RevokeRoleCommand } from './commands/revoke-role.command.js';
import { SetUserStatusCommand } from './commands/set-user-status.command.js';
import { SwitchRoleCommand } from './commands/switch-role.command.js';
import { PartnerQueries } from './partner.queries.js';
import { RoleRepository } from './repositories/role.repository.js';
import { UserRepository } from './repositories/user.repository.js';

/**
 * None of the admin user providers needs `FirebaseVerifierService`, which is what lets the HTTP
 * test harness provide them directly instead of importing this module.
 */
const ADMIN_USER_PROVIDERS = [
  AdminUserQueries,
  GrantRoleCommand,
  RevokeRoleCommand,
  SetUserStatusCommand,
  PartnerQueries,
  ReviewPartnerCommand,
];

@Module({
  providers: [
    CreateSessionCommand,
    SwitchRoleCommand,
    UserRepository,
    RoleRepository,
    ...ADMIN_USER_PROVIDERS,
  ],
  exports: [
    CreateSessionCommand,
    SwitchRoleCommand,
    UserRepository,
    RoleRepository,
    ...ADMIN_USER_PROVIDERS,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class IdentityModule {}
