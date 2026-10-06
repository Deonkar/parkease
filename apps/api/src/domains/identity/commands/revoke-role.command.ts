import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role, RoleStatus } from '@parkease/contracts/enums';
import { userRoles, users } from '@parkease/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { RoleNotHeldError, SelfDemotionError } from '../errors.js';

export interface RevokeRoleInput {
  readonly userId: string;
  readonly role: Role;
  readonly reason: string;
}

/**
 * Task 18a §users. Revoking suspends the row rather than deleting it: the grant history stays,
 * and a later grant reactivates it.
 *
 * It does not touch refresh tokens. A session already open keeps its old `roles` claim for at
 * most one access-token lifetime (15 minutes); the next refresh re-reads the database and drops
 * the role, and the admin panel's refresh refuses outright once `admin` is gone.
 */
@Injectable()
export class RevokeRoleCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  execute(input: RevokeRoleInput, actor: AdminActor): Promise<void> {
    const { userId, role, reason } = input;
    if (role === Role.ADMIN && userId === actor.userId) {
      return Promise.reject(new SelfDemotionError());
    }

    return withTransaction(this.db, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (user === undefined) throw new NotFoundException('User not found.');

      const [held] = await tx
        .select({ id: userRoles.id, status: userRoles.status })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.role, role),
            inArray(userRoles.status, [RoleStatus.ACTIVE, RoleStatus.PENDING]),
          ),
        );
      if (held === undefined) throw new RoleNotHeldError();

      await tx
        .update(userRoles)
        .set({ status: RoleStatus.SUSPENDED, updatedAt: new Date() })
        .where(eq(userRoles.id, held.id));

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: 'user.role.revoke',
        targetType: 'user',
        targetId: userId,
        before: { status: held.status },
        after: { role, status: RoleStatus.SUSPENDED, reason },
        ipAddress: actor.ipAddress,
      });
    });
  }
}
