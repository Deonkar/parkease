import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import type { SessionTokens } from '../../../platform/auth/token.service.js';
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

  async execute(input: SwitchRoleInput): Promise<SessionTokens> {
    return withTransaction(this.db, async (tx) => {
      const hasRole = await this.roleRepo.hasActiveRole(tx, input.userId, input.role);

      if (!hasRole) {
        throw new ForbiddenException("You don't have permission to do that.");
      }

      const roles = await this.roleRepo.listActive(tx, input.userId);

      return this.tokenService.issue(tx, {
        userId: input.userId,
        roles: roles.map((r) => r.role),
        activeRole: input.role,
      });
    });
  }
}
