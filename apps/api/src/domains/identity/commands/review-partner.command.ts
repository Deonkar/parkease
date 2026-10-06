import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PartnerKind } from '@parkease/contracts/admin';
import { RoleStatus, VerificationStatus } from '@parkease/contracts/enums';
import { userRoles, valetProfiles, washerProfiles } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { type TxHandle, withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { IllegalVerificationTransitionError, RoleNotHeldError } from '../errors.js';

export interface ReviewPartnerInput {
  readonly userId: string;
  readonly kind: PartnerKind;
}

export interface RejectPartnerInput extends ReviewPartnerInput {
  readonly notes: string;
}

interface LockedProfile {
  readonly userId: string;
  readonly status: string;
}

/**
 * Task 18a §partners. Verifying a valet or washer is what makes them eligible for paid jobs, so the
 * decision is one transaction: the profile's verification status, the role that lets them sign in
 * as a partner, the audit row, and the announcement the partner is told by (task 19).
 *
 * Only a `pending` profile can be decided. The profile row is locked first, so two admins pressing
 * the button at once cannot both win: the second finds it decided and gets a 409.
 */
@Injectable()
export class ReviewPartnerCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  verify(input: ReviewPartnerInput, actor: AdminActor): Promise<void> {
    return this.decide(input, actor, VerificationStatus.VERIFIED, undefined);
  }

  reject(input: RejectPartnerInput, actor: AdminActor): Promise<void> {
    return this.decide(input, actor, VerificationStatus.REJECTED, input.notes);
  }

  private decide(
    { userId, kind }: ReviewPartnerInput,
    actor: AdminActor,
    to: typeof VerificationStatus.VERIFIED | typeof VerificationStatus.REJECTED,
    notes: string | undefined,
  ): Promise<void> {
    const approving = to === VerificationStatus.VERIFIED;

    return withTransaction(this.db, async (tx) => {
      const profile = await this.lockProfile(tx, kind, userId);
      if (profile === undefined) throw new NotFoundException('Partner not found.');
      if (profile.status !== VerificationStatus.PENDING)
        throw new IllegalVerificationTransitionError();

      // The canonical id: the database returns a uuid in its own lowercase form, while the path
      // parameter may be the same uuid in capitals. Everything written below uses this one.
      const id = profile.userId;
      const now = new Date();

      await this.setProfileStatus(tx, kind, id, to, now);
      const role = await this.settleRole(tx, kind, id, approving, now);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: approving ? 'partner.verify' : 'partner.reject',
        targetType: `${kind}_profile`,
        targetId: id,
        before: { verificationStatus: profile.status, roleStatus: role.before },
        after: {
          verificationStatus: to,
          roleStatus: role.after,
          ...(notes === undefined ? {} : { notes }),
        },
        ipAddress: actor.ipAddress,
      });

      await this.outbox.enqueue(tx, {
        type: approving ? 'partner.verified' : 'partner.rejected',
        payload: { userId: id, kind },
      });
    });
  }

  private async lockProfile(
    tx: TxHandle,
    kind: PartnerKind,
    userId: string,
  ): Promise<LockedProfile | undefined> {
    if (kind === 'valet') {
      const [row] = await tx
        .select({ userId: valetProfiles.userId, status: valetProfiles.verificationStatus })
        .from(valetProfiles)
        .where(eq(valetProfiles.userId, userId))
        .for('update');
      return row;
    }

    const [row] = await tx
      .select({ userId: washerProfiles.userId, status: washerProfiles.verificationStatus })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, userId))
      .for('update');
    return row;
  }

  private async setProfileStatus(
    tx: TxHandle,
    kind: PartnerKind,
    userId: string,
    status: string,
    now: Date,
  ): Promise<void> {
    if (kind === 'valet') {
      await tx
        .update(valetProfiles)
        .set({ verificationStatus: status, updatedAt: now })
        .where(eq(valetProfiles.userId, userId));
      return;
    }

    await tx
      .update(washerProfiles)
      .set({ verificationStatus: status, updatedAt: now })
      .where(eq(washerProfiles.userId, userId));
  }

  /**
   * The partner role follows the decision, but only where it is the decision's to move:
   *
   * - **Verify** opens a role that is waiting (`pending`) or was closed by an earlier rejection
   *   (`rejected`, then the partner re-submitted). An `active` role needs nothing and a `suspended`
   *   one stays suspended: verifying documents is not a reinstatement. A role that does not exist
   *   is refused (`ROLE_NOT_HELD`); this command never creates one.
   * - **Reject** closes a role that is still `pending`. An `active` one (a verified partner whose
   *   re-submitted documents were refused) is left, because the profile status is what gates jobs.
   */
  private async settleRole(
    tx: TxHandle,
    kind: PartnerKind,
    userId: string,
    approving: boolean,
    now: Date,
  ): Promise<{ before: string | null; after: string | null }> {
    const [role] = await tx
      .select({ id: userRoles.id, status: userRoles.status })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, kind)))
      .for('update');
    const before = role?.status ?? null;

    if (approving) {
      // A profile only exists for someone who already holds the role, so a missing row is a state
      // no flow produces. It is refused rather than repaired: this command moves a role's status,
      // and the admin grant is the one place a role is created, with a reason.
      if (role === undefined) throw new RoleNotHeldError();
      if (role.status === RoleStatus.PENDING || role.status === RoleStatus.REJECTED) {
        await tx
          .update(userRoles)
          .set({ status: RoleStatus.ACTIVE, verifiedAt: now, updatedAt: now })
          .where(eq(userRoles.id, role.id));
        return { before, after: RoleStatus.ACTIVE };
      }
      return { before, after: before };
    }

    if (role?.status === RoleStatus.PENDING) {
      await tx
        .update(userRoles)
        .set({ status: RoleStatus.REJECTED, updatedAt: now })
        .where(eq(userRoles.id, role.id));
      return { before, after: RoleStatus.REJECTED };
    }
    return { before, after: before };
  }
}
