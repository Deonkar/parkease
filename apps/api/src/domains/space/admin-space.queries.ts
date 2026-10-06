import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminSpaceDetail,
  AdminSpaceQueueItem,
  AdminSpaceQueueQuery,
} from '@parkease/contracts/admin';
import { approvalStatusSchema } from '@parkease/contracts/enums';
import { maskPhone, spaceIdSchema, userIdSchema } from '@parkease/contracts/primitives';
import { spacePhotos, spaces, users } from '@parkease/db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

/**
 * An owner who has never had a listing approved is the one an admin looks at hardest. `inactive`
 * counts: a space only becomes inactive by having been active first (`ToggleSpaceCommand`).
 */
const isFirstListing = sql<boolean>`NOT EXISTS (
  SELECT 1 FROM spaces other
   WHERE other.owner_id = ${spaces.ownerId}
     AND other.id <> ${spaces.id}
     AND other.deleted_at IS NULL
     AND other.approval_status IN ('active', 'inactive')
)`;

/** Queue order: oldest submission first. `created_at` covers a row that has no `submitted_at`. */
const queuedAt = sql`COALESCE(${spaces.submittedAt}, ${spaces.createdAt})`;

const queueColumns = {
  id: spaces.id,
  title: spaces.title,
  addressLine: spaces.addressLine,
  city: spaces.city,
  ownerId: spaces.ownerId,
  ownerName: users.name,
  ownerPhone: users.phone,
  isFirstListing,
  approvalStatus: spaces.approvalStatus,
  submittedAt: spaces.submittedAt,
  createdAt: spaces.createdAt,
  reviewNotes: spaces.reviewNotes,
};

interface QueueRow {
  readonly id: string;
  readonly title: string;
  readonly addressLine: string;
  readonly city: string;
  readonly ownerId: string;
  readonly ownerName: string | null;
  readonly ownerPhone: string;
  readonly isFirstListing: boolean;
  readonly approvalStatus: string;
  readonly submittedAt: Date | null;
  readonly createdAt: Date;
  readonly reviewNotes: string | null;
}

/**
 * What the moderation screens read. The owner's phone is masked here, before a row leaves the
 * domain, so no caller can forget to — an admin screen never holds a callable number.
 */
@Injectable()
export class AdminSpaceQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async queue(q: AdminSpaceQueueQuery): Promise<{ items: AdminSpaceQueueItem[]; total: number }> {
    const where = and(eq(spaces.approvalStatus, q.status), isNull(spaces.deletedAt));

    const [rows, [count]] = await Promise.all([
      this.db
        .select(queueColumns)
        .from(spaces)
        .innerJoin(users, eq(users.id, spaces.ownerId))
        .where(where)
        .orderBy(asc(queuedAt), asc(spaces.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(spaces)
        .where(where),
    ]);

    return { items: rows.map(toQueueItem), total: count?.total ?? 0 };
  }

  async detail(spaceId: string): Promise<AdminSpaceDetail | undefined> {
    const [row] = await this.db
      .select({
        ...queueColumns,
        description: spaces.description,
        pricing: spaces.pricing,
        schedule: spaces.schedule,
        amenities: spaces.amenities,
        location: spaces.location,
        zoneId: spaces.zoneId,
        reviewedAt: spaces.reviewedAt,
      })
      .from(spaces)
      .innerJoin(users, eq(users.id, spaces.ownerId))
      .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)));
    if (row === undefined) return undefined;

    const photos = await this.db
      .select({ url: spacePhotos.url })
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, spaceId))
      .orderBy(asc(spacePhotos.displayOrder));

    return {
      ...toQueueItem(row),
      description: row.description,
      photos: photos.map((p) => p.url),
      pricing: row.pricing,
      schedule: row.schedule,
      amenities: row.amenities,
      latitude: row.location.lat,
      longitude: row.location.lng,
      zoneId: row.zoneId,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  }
}

function toQueueItem(row: QueueRow): AdminSpaceQueueItem {
  return {
    id: spaceIdSchema.parse(row.id),
    title: row.title,
    address: `${row.addressLine}, ${row.city}`,
    ownerId: userIdSchema.parse(row.ownerId),
    ownerName: row.ownerName,
    ownerPhone: maskPhone(row.ownerPhone),
    isFirstListing: row.isFirstListing,
    approvalStatus: approvalStatusSchema.parse(row.approvalStatus),
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    reviewNotes: row.reviewNotes,
  };
}
