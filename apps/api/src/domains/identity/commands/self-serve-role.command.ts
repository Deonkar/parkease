import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role, RoleStatus } from '@parkease/contracts/enums';
import type { RoleSession, SelfServeRole } from '@parkease/contracts/shared';
import { userRoles, users } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import { TokenService } from '../../../platform/auth/token.service.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { AuditService } from '../../../platform/observability/audit.service.js';
import { RoleSuspendedError } from '../errors.js';
import { RoleRepository } from '../repositories/role.repository.js';

export interface SelfServeRoleInput {
  readonly userId: string;
  readonly role: SelfServeRole['role'];
  readonly actingAs: string | null;
  readonly ipAddress: string | null;
}

/**
 * A person takes on a role themselves (S-149; product decision 2026-10-12: self-serve, gated).
 *
 * The role opens at once and the session switches into it, so the profile entry point lands the
 * person in the new shell in one call. What gates them is not the role:
 * - **owner**: a listing goes live only once an admin approves it (task 18a), and payouts only
 *   once Route onboarding activates.
 * - **valet / washer**: the partner profile starts unverified, and every way to work checks it —
 *   offers go to verified partners only, going online refuses an unverified one. Registering and
 *   uploading documents need the role, which is why it opens now.
 *
 * Idempotent: a role already open answers a session and writes nothing. A suspended role is the
 * platform's decision and stays closed (403 ROLE_SUSPENDED); a rejected or pending one reopens,
 * since re-applying is exactly what this is for. Every grant is audited as the person's own.
 */
@Injectable()
export class SelfServeRoleCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly roles: RoleRepository,
  ) {}

  execute(input: SelfServeRoleInput): Promise<RoleSession> {
    const role = input.role as Role;

    return withTransaction(this.db, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .for('no key update');
      if (user === undefined) throw new NotFoundException('User not found.');

      const [existing] = await tx
        .select({ id: userRoles.id, status: userRoles.status })
        .from(userRoles)
        .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, role)));
      if (existing?.status === RoleStatus.SUSPENDED) throw new RoleSuspendedError();

      if (existing?.status !== RoleStatus.ACTIVE) {
        const now = new Date();
        const grant = {
          status: RoleStatus.ACTIVE,
          grantedAt: now,
          grantedByUserId: user.id,
          // Owners are verified by their listing's approval, partners by their profile's.
          verifiedAt: role === Role.OWNER ? now : null,
        };
        if (existing === undefined) {
          await tx.insert(userRoles).values({ userId: user.id, role, ...grant });
        } else {
          await tx
            .update(userRoles)
            .set({ ...grant, updatedAt: now })
            .where(eq(userRoles.id, existing.id));
        }
        await this.audit.record(tx, {
          actorUserId: user.id,
          actorRole: input.actingAs,
          action: 'user.role.self-grant',
          targetType: 'user',
          targetId: user.id,
          before: { status: existing?.status ?? null },
          after: { role, status: RoleStatus.ACTIVE },
          ipAddress: input.ipAddress,
        });
      }

      const held = (await this.roles.listActive(tx, user.id)).map((r) => r.role as Role);
      const session = await this.tokens.issue(tx, {
        userId: user.id,
        roles: held,
        activeRole: role,
      });
      return { ...session, roles: held, activeRole: role };
    });
  }
}
