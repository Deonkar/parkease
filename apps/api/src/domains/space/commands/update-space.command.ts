import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus } from '@parkease/contracts/enums';
import type { UpdateSpace } from '@parkease/contracts/owner';
import { spaces, spaceSlots } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { expandSlotRows } from '../slots.js';

export interface UpdateSpaceInput {
  readonly ownerId: string;
  readonly spaceId: string;
  readonly body: UpdateSpace;
}

@Injectable()
export class UpdateSpaceCommand {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: UpdateSpaceInput) {
    return withTransaction(this.db, async (tx) => {
      const [existing] = await tx
        .select()
        .from(spaces)
        .where(
          and(
            eq(spaces.id, input.spaceId),
            eq(spaces.ownerId, input.ownerId),
            isNull(spaces.deletedAt),
          ),
        );

      if (!existing) throw new NotFoundException('Space not found.');

      const set: Record<string, unknown> = { updatedAt: new Date() };
      const b = input.body;

      if (b.title !== undefined) set['title'] = b.title;
      if (b.description !== undefined) set['description'] = b.description;
      if (b.address !== undefined) {
        set['addressLine'] = b.address.line;
        set['landmark'] = b.address.landmark ?? null;
        set['city'] = b.address.city;
        set['state'] = b.address.city;
        set['pincode'] = b.address.pincode;
        set['zoneId'] = `zone_${b.address.pincode}`;
      }
      if (b.location !== undefined) {
        set['location'] = { lng: b.location.lng, lat: b.location.lat };
      }
      if (b.pricing !== undefined) set['pricing'] = b.pricing;
      if (b.schedule !== undefined) set['schedule'] = b.schedule;
      if (b.amenities !== undefined) set['amenities'] = b.amenities;
      if (b.accessInstructions !== undefined) set['accessInstructions'] = b.accessInstructions;

      if (
        existing.approvalStatus === ApprovalStatus.CHANGES_REQUESTED ||
        existing.approvalStatus === ApprovalStatus.REJECTED
      ) {
        set['approvalStatus'] = ApprovalStatus.PENDING_APPROVAL;
        set['submittedAt'] = new Date();
        set['rejectionReason'] = null;
      }

      await tx.update(spaces).set(set).where(eq(spaces.id, input.spaceId));

      if (b.slots !== undefined) {
        await tx.delete(spaceSlots).where(eq(spaceSlots.spaceId, input.spaceId));
        const slotRows = expandSlotRows(input.spaceId, b.slots);
        if (slotRows.length > 0) {
          await tx.insert(spaceSlots).values(slotRows);
        }
      }

      await this.outbox.enqueue(tx, {
        type: 'space.updated',
        payload: { spaceId: input.spaceId, ownerId: input.ownerId },
      });

      return { id: input.spaceId };
    });
  }
}
