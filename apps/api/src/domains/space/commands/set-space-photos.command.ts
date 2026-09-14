import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SetSpacePhotos } from '@parkease/contracts/owner';
import { MAX_PHOTOS_PER_SPACE } from '@parkease/contracts/owner';
import { spaces, spacePhotos } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { SpaceService } from '../space.service.js';

export interface SetSpacePhotosInput {
  readonly ownerId: string;
  readonly spaceId: string;
  readonly body: SetSpacePhotos;
}

@Injectable()
export class SetSpacePhotosCommand {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async execute(input: SetSpacePhotosInput) {
    const space = await this.spaceService.findOwnedBy(input.spaceId, input.ownerId);
    if (!space) throw new NotFoundException('Space not found.');

    if (input.body.photos.length > MAX_PHOTOS_PER_SPACE) {
      throw new ConflictException('Maximum ' + String(MAX_PHOTOS_PER_SPACE) + ' photos allowed');
    }

    const existing = await this.spaceService.listPhotos(input.spaceId);
    const existingByPublicId = new Map(existing.map((p) => [p.cloudinaryPublicId, p]));

    const hasPrimary = input.body.photos.some((p) => p.isPrimary);
    const rows = input.body.photos.map((photo, idx) => {
      const ex = existingByPublicId.get(photo.publicId);
      return {
        spaceId: input.spaceId,
        cloudinaryPublicId: photo.publicId,
        url: ex?.url ?? '',
        format: ex?.format ?? 'jpg',
        bytes: ex?.bytes ?? 0,
        width: ex?.width ?? 0,
        height: ex?.height ?? 0,
        displayOrder: idx,
        isPrimary: hasPrimary ? photo.isPrimary : idx === 0,
      };
    });

    return withTransaction(this.db, async (tx) => {
      await tx.delete(spacePhotos).where(eq(spacePhotos.spaceId, input.spaceId));

      if (rows.length > 0) {
        await tx.insert(spacePhotos).values(rows);
      }

      await tx.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, input.spaceId));

      await this.outbox.enqueue(tx, {
        type: 'space.photos_updated',
        payload: { spaceId: input.spaceId, ownerId: input.ownerId },
      });

      return { id: input.spaceId };
    });
  }
}
