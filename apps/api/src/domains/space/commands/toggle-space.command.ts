import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus } from '@parkease/contracts/enums';
import { spaces } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

export interface ToggleSpaceInput {
  readonly ownerId: string;
  readonly spaceId: string;
}

@Injectable()
export class ToggleSpaceCommand {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: ToggleSpaceInput) {
    return withTransaction(this.db, async (tx) => {
      const [space] = await tx
        .select({ id: spaces.id, approvalStatus: spaces.approvalStatus })
        .from(spaces)
        .where(
          and(
            eq(spaces.id, input.spaceId),
            eq(spaces.ownerId, input.ownerId),
            isNull(spaces.deletedAt),
          ),
        );

      if (!space) throw new NotFoundException('Space not found.');

      const current = space.approvalStatus;
      if (current !== ApprovalStatus.ACTIVE && current !== ApprovalStatus.INACTIVE) {
        throw new ConflictException('TOGGLE_NOT_ALLOWED');
      }

      const next =
        current === ApprovalStatus.ACTIVE ? ApprovalStatus.INACTIVE : ApprovalStatus.ACTIVE;
      const now = new Date();

      await tx
        .update(spaces)
        .set({
          approvalStatus: next,
          updatedAt: now,
          approvedAt: next === ApprovalStatus.ACTIVE ? now : undefined,
        })
        .where(eq(spaces.id, input.spaceId));

      await this.outbox.enqueue(tx, {
        type: next === ApprovalStatus.ACTIVE ? 'space.activated' : 'space.deactivated',
        payload: { spaceId: input.spaceId, ownerId: input.ownerId },
      });

      return { id: input.spaceId, approvalStatus: next };
    });
  }
}
