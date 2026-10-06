import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role, RoleStatus } from '@parkease/contracts/enums';
import { userRoles, users } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { RoleAlreadyHeldError } from '../errors.js';

export interface GrantRoleInput {
  readonly userId: string;
  readonly role: Role;
  readonly reason: string;
}

/** Valet and washer owe a verification step the admin grant does not replace. */
const initialStatus = (role: Role): RoleStatus =>
  role === Role.VALET || role === Role.WASHER ? RoleStatus.PENDING : RoleStatus.ACTIVE;

/**
 * Task 18a §users. The user's row is locked first, so two admins changing one person's roles
 * serialise instead of racing the unique key on `(user_id, role)` into a 409 that names the wrong
 * thing. Granting over a suspended or rejected row reactivates it: that row is the user's history
 * with the role, and a second row for it cannot exist.
 */
@Injectable()
export class GrantRoleCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  execute(input: GrantRoleInput, actor: AdminActor): Promise<void> {
    const { userId, role, reason } = input;
    const status = initialStatus(role);

    return withTransaction(this.db, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        // NO KEY UPDATE, not UPDATE: the audit insert below takes FOR KEY SHARE on the ACTOR's row, so
        // two admins acting on each other deadlocked under FOR UPDATE (DB-9). Writers still serialise.
        .for('no key update');
      if (user === undefined) throw new NotFoundException('User not found.');

      const [existing] = await tx
        .select({ id: userRoles.id, status: userRoles.status })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));

      if (
        existing?.status === RoleStatus.ACTIVE ||
        // Already waiting on verification: granting again would change nothing.
        existing?.status === RoleStatus.PENDING
      ) {
        throw new RoleAlreadyHeldError();
      }

      const now = new Date();
      const grant = {
        status,
        grantedAt: now,
        grantedByUserId: actor.userId,
        verifiedAt: status === RoleStatus.ACTIVE ? now : null,
      };

      if (existing === undefined) {
        await tx.insert(userRoles).values({ userId, role, ...grant });
      } else {
        await tx
          .update(userRoles)
          .set({ ...grant, updatedAt: now })
          .where(eq(userRoles.id, existing.id));
      }

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: 'user.role.grant',
        targetType: 'user',
        targetId: userId,
        before: { status: existing?.status ?? null },
        after: { role, status, reason },
        ipAddress: actor.ipAddress,
      });
    });
  }
}
