import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Role } from '@parkease/contracts/enums';
import type { RoleSession } from '@parkease/contracts/shared';

import { TokenService } from '../../../platform/auth/token.service.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { RoleRepository } from '../repositories/role.repository.js';

export interface SwitchRoleInput {
  readonly userId: string;
  readonly role: string;
}

@Injectable()
export class SwitchRoleCommand {
  constructor(
    private readonly tokenService: TokenService,
    private readonly roleRepo: RoleRepository,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: SwitchRoleInput): Promise<RoleSession> {
    return withTransaction(this.db, async (tx) => {
      const hasRole = await this.roleRepo.hasActiveRole(tx, input.userId, input.role);

      if (!hasRole) {
        throw new ForbiddenException("You don't have permission to do that.");
      }

      const roles = (await this.roleRepo.listActive(tx, input.userId)).map((r) => r.role as Role);
      const session = await this.tokenService.issue(tx, {
        userId: input.userId,
        roles,
        activeRole: input.role,
      });
      // The roles and the active one ride along: the app read `activeRole` from this answer
      // while the API sent tokens only, so a switch left it with no role (S-149).
      return { ...session, roles, activeRole: input.role as Role };
    });
  }
}
