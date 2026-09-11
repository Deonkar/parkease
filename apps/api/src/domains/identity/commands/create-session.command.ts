import { ForbiddenException, Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { UserStatus } from '@parkease/contracts/enums';

import { FirebaseVerifierService } from '../../../platform/auth/firebase-verifier.service.js';
import type { SessionTokens } from '../../../platform/auth/token.service.js';
import { TokenService } from '../../../platform/auth/token.service.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { RoleRepository } from '../repositories/role.repository.js';
import { UserRepository } from '../repositories/user.repository.js';

export interface CreateSessionInput {
  readonly idToken: string;
  readonly userAgent?: string | undefined;
}

export interface CreateSessionResult extends SessionTokens {
  readonly roles: string[];
  readonly activeRole: string | null;
  readonly isNewUser: boolean;
}

function pickActiveRole(roles: readonly { role: string }[], preferredRole?: string): string | null {
  if (roles.length === 0) return null;
  if (preferredRole) {
    const match = roles.find((r) => r.role === preferredRole);
    if (match) return match.role;
  }
  const first = roles[0];
  return first ? first.role : null;
}

@Injectable()
export class CreateSessionCommand {
  constructor(
    private readonly firebase: FirebaseVerifierService,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepository,
    private readonly roleRepo: RoleRepository,
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: CreateSessionInput): Promise<CreateSessionResult> {
    const verified = await this.firebase.verify(input.idToken);

    return withTransaction(this.db, async (tx) => {
      const user = await this.userRepo.upsertByPhone(tx, verified);

      if (user.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('This account has been suspended. Contact support.');
      }

      const roles = await this.roleRepo.listActive(tx, user.id);
      const activeRole = pickActiveRole(roles);

      const session = await this.tokenService.issue(tx, {
        userId: user.id,
        roles: roles.map((r) => r.role),
        activeRole,
        userAgent: input.userAgent,
      });

      await this.outbox.enqueue(tx, {
        type: 'identity.session-created',
        payload: { userId: user.id, isNewUser: user.isNew },
      });

      return {
        ...session,
        roles: roles.map((r) => r.role),
        activeRole,
        isNewUser: user.isNew,
      };
    });
  }
}
