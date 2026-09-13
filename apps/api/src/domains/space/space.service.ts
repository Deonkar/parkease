import { Inject, Injectable } from '@nestjs/common';
import { spaces, spaceSlots, spacePhotos } from '@parkease/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

@Injectable()
export class SpaceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findOwnedBy(spaceId: string, ownerId: string) {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)));
    return space;
  }

  async listByOwner(ownerId: string, opts: { page: number; limit: number }) {
    const offset = (opts.page - 1) * opts.limit;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)))
        .orderBy(desc(spaces.createdAt))
        .limit(opts.limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(spaces)
        .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt))),
    ]);

    const total = countRow?.count ?? 0;
    return {
      items,
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async getSlots(spaceId: string) {
    return this.db.select().from(spaceSlots).where(eq(spaceSlots.spaceId, spaceId));
  }

  async listPhotos(spaceId: string) {
    return this.db
      .select()
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, spaceId))
      .orderBy(spacePhotos.displayOrder);
  }

  async loadRelated(spaceId: string) {
    const [slots, photos] = await Promise.all([this.getSlots(spaceId), this.listPhotos(spaceId)]);
    return { slots, photos };
  }
}
