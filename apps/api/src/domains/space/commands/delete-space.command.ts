import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { bookings, spaces } from '@parkease/db/schema';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

export interface DeleteSpaceInput {
  readonly ownerId: string;
  readonly spaceId: string;
}

@Injectable()
export class DeleteSpaceCommand {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: DeleteSpaceInput): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const [space] = await tx
        .select({ id: spaces.id })
        .from(spaces)
        .where(
          and(
            eq(spaces.id, input.spaceId),
            eq(spaces.ownerId, input.ownerId),
            isNull(spaces.deletedAt),
          ),
        );

      if (!space) throw new NotFoundException('Space not found.');

      const [liveBooking] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.spaceId, input.spaceId),
            inArray(bookings.status, ['confirmed', 'active']),
            gt(bookings.endsAt, new Date()),
          ),
        )
        .limit(1);

      if (liveBooking) {
        throw new ConflictException('SPACE_HAS_LIVE_BOOKINGS');
      }

      const now = new Date();
      await tx
        .update(spaces)
        .set({ deletedAt: now, approvalStatus: 'inactive', updatedAt: now })
        .where(eq(spaces.id, input.spaceId));

      await this.outbox.enqueue(tx, {
        type: 'space.deleted',
        payload: { spaceId: input.spaceId, ownerId: input.ownerId },
      });
    });
  }
}
