import { Inject, Injectable } from '@nestjs/common';
import { ApprovalStatus } from '@parkease/contracts/enums';
import type { CreateSpace } from '@parkease/contracts/owner';
import { spaces, spaceSlots } from '@parkease/db/schema';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { ApprovalService } from '../approval.service.js';
import { expandSlotRows } from '../slots.js';

export interface CreateSpaceInput {
  readonly ownerId: string;
  readonly body: CreateSpace;
}

@Injectable()
export class CreateSpaceCommand {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: CreateSpaceInput) {
    return withTransaction(this.db, async (tx) => {
      const approvalStatus = await this.approvalService.resolveInitialStatus(tx, input.ownerId);
      const wentLiveImmediately = approvalStatus === ApprovalStatus.ACTIVE;
      const now = new Date();

      const [space] = await tx
        .insert(spaces)
        .values({
          ownerId: input.ownerId,
          title: input.body.title,
          description: input.body.description ?? null,
          addressLine: input.body.address.line,
          landmark: input.body.address.landmark ?? null,
          city: input.body.address.city,
          state: input.body.address.city,
          pincode: input.body.address.pincode,
          location: { lng: input.body.location.lng, lat: input.body.location.lat },
          zoneId: `zone_${input.body.address.pincode}`,
          pricing: input.body.pricing,
          schedule: input.body.schedule,
          amenities: input.body.amenities,
          accessInstructions: input.body.accessInstructions ?? null,
          approvalStatus,
          approvedAt: wentLiveImmediately ? now : null,
          submittedAt: now,
        })
        .returning();

      if (!space) throw new Error('INSERT spaces RETURNING yielded no row');

      const slotRows = expandSlotRows(space.id, input.body.slots);
      if (slotRows.length > 0) {
        await tx.insert(spaceSlots).values(slotRows);
      }

      await this.outbox.enqueue(tx, {
        type: wentLiveImmediately ? 'space.activated' : 'space.submitted',
        payload: { spaceId: space.id, ownerId: input.ownerId },
      });

      return { id: space.id, approvalStatus: space.approvalStatus };
    });
  }
}
