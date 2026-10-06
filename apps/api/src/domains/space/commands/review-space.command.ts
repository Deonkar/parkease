import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminSpaceDecision } from '@parkease/contracts/admin';
import { ApprovalStatus } from '@parkease/contracts/enums';
import { spaces } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { IllegalApprovalTransitionError } from '../errors.js';

/**
 * Every admin decision, in one place: where it leaves the space, and what it is called in the
 * audit log and on the outbox. Each is only legal from `pending_approval`.
 */
const DECISIONS = {
  approve: { to: ApprovalStatus.ACTIVE, audit: 'space.approve', event: 'space.approved' },
  reject: { to: ApprovalStatus.REJECTED, audit: 'space.reject', event: 'space.rejected' },
  request_changes: {
    to: ApprovalStatus.CHANGES_REQUESTED,
    audit: 'space.request-changes',
    event: 'space.changes-requested',
  },
} as const satisfies Record<
  AdminSpaceDecision,
  { to: ApprovalStatus; audit: string; event: string }
>;

export interface ReviewOutcome {
  readonly id: string;
  readonly approvalStatus: ApprovalStatus;
}

/**
 * Task 18a §spaces. The row is locked before its status is read, so two admins deciding the same
 * space at once serialise: the second sees the first's result and gets a 409 instead of a second
 * audit row and a second notification. The owner is told through the outbox, never from here.
 */
@Injectable()
export class ReviewSpaceCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  approve(spaceId: string, actor: AdminActor): Promise<ReviewOutcome> {
    return this.decide('approve', spaceId, null, actor);
  }

  reject(spaceId: string, notes: string, actor: AdminActor): Promise<ReviewOutcome> {
    return this.decide('reject', spaceId, notes, actor);
  }

  requestChanges(spaceId: string, notes: string, actor: AdminActor): Promise<ReviewOutcome> {
    return this.decide('request_changes', spaceId, notes, actor);
  }

  private decide(
    decision: AdminSpaceDecision,
    spaceId: string,
    notes: string | null,
    actor: AdminActor,
  ): Promise<ReviewOutcome> {
    const { to, audit, event } = DECISIONS[decision];

    return withTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select({
          ownerId: spaces.ownerId,
          approvalStatus: spaces.approvalStatus,
          reviewNotes: spaces.reviewNotes,
        })
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
        .for('update');

      if (before === undefined) throw new NotFoundException('Space not found.');
      if (before.approvalStatus !== ApprovalStatus.PENDING_APPROVAL) {
        throw new IllegalApprovalTransitionError();
      }

      const now = new Date();
      await tx
        .update(spaces)
        .set({
          approvalStatus: to,
          reviewNotes: notes,
          reviewedByUserId: actor.userId,
          reviewedAt: now,
          updatedAt: now,
          // The owner's own view reads these two for "approved on".
          ...(decision === 'approve' ? { approvedAt: now, approvedByUserId: actor.userId } : {}),
        })
        .where(eq(spaces.id, spaceId));

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: audit,
        targetType: 'space',
        targetId: spaceId,
        before: { approvalStatus: before.approvalStatus, reviewNotes: before.reviewNotes },
        after: { approvalStatus: to, reviewNotes: notes },
        ipAddress: actor.ipAddress,
      });

      await this.outbox.enqueue(tx, {
        type: event,
        payload: { spaceId, ownerId: before.ownerId, notes },
      });

      return { id: spaceId, approvalStatus: to };
    });
  }
}
