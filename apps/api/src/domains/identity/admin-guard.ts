import { Role, RoleStatus, UserStatus } from '@parkease/contracts/enums';
import { userRoles, users } from '@parkease/db/schema';
import { and, asc, eq } from 'drizzle-orm';

import type { TxHandle } from '../../platform/db/transaction.js';

import { LastAdminError } from './errors.js';

/**
 * Refuses to take admin access from `targetUserId` unless the actor still holds it and someone
 * besides the target will (S-142).
 *
 * The self-demotion check alone cannot see two admins revoking each other at the same moment:
 * each locks only the other's user row, both commit, and nobody is left. Every active admin role
 * row is locked here, in id order so concurrent callers queue rather than deadlock, and the second
 * caller re-reads the set after the first commits: by then it is either no longer an admin or the
 * last one.
 */
export async function assertAdminsRemain(
  tx: TxHandle,
  targetUserId: string,
  actorUserId: string,
): Promise<void> {
  const admins = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.role, Role.ADMIN),
        eq(userRoles.status, RoleStatus.ACTIVE),
        eq(users.status, UserStatus.ACTIVE),
      ),
    )
    .orderBy(asc(userRoles.id))
    .for('update', { of: userRoles });

  const ids = new Set(admins.map((a) => a.userId));
  if (!ids.has(actorUserId)) throw new LastAdminError();
  ids.delete(targetUserId);
  if (ids.size === 0) throw new LastAdminError();
}
