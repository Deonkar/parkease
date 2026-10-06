import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminPartner,
  type AdminPartnersQuery,
  type PartnerKind,
  partnerKindSchema,
} from '@parkease/contracts/admin';
import { verificationStatusSchema } from '@parkease/contracts/enums';
import { maskPhone, userIdSchema } from '@parkease/contracts/primitives';
import { users, valetProfiles, washerProfiles } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../platform/db/db.module.js';

/**
 * The upload ids an admin reviews, exactly as the profile stores them (Cloudinary's own `public_id`
 * from the upload response). Turning them into links is the controller layer's job: this domain
 * does not know what a signed URL is.
 */
export interface PartnerDocumentIds {
  readonly licence: string | null;
  readonly idProof: string | null;
  readonly businessPhotos: readonly string[];
}

export interface PartnerRecord extends AdminPartner {
  readonly vehicleNumber: string | null;
  readonly operatingHours: unknown;
  readonly documentIds: PartnerDocumentIds;
}

/**
 * One row of the queue. `requested_at` is a JSON timestamp (ISO 8601) because a raw `db.execute`
 * hands a timestamptz back as the driver's text form, which `Date` does not reliably parse.
 */
const queueRowSchema = z.object({
  user_id: z.string(),
  kind: partnerKindSchema,
  display_name: z.string().nullable(),
  verification_status: verificationStatusSchema,
  requested_at: z.string().datetime({ offset: true }),
  name: z.string().nullable(),
  phone: z.string(),
});

const totalRowSchema = z.object({ total: z.number().int() });

/**
 * What the partner-verification screens read. Verification is a *role status*, which identity owns,
 * but the facts live in two profile tables (valet, washer); this is the one place that spans both.
 *
 * The queue is oldest first: a partner waiting a week is ahead of one who submitted this morning.
 * `requested_at` is the profile's last write, which for a pending profile is the submission that
 * made it pending: nothing else writes a profile that is waiting on review.
 */
@Injectable()
export class PartnerQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(q: AdminPartnersQuery): Promise<{ items: AdminPartner[]; total: number }> {
    const kindFilter = q.kind === undefined ? sql`` : sql` AND p.kind = ${q.kind}`;

    // Raw SQL because it is a UNION across two tables, which the builder cannot page.
    const queue = sql`
      WITH partners AS (
        SELECT v.user_id, 'valet'::text AS kind, NULL::text AS display_name,
               v.verification_status, v.updated_at AS requested_at
          FROM valet_profiles v
        UNION ALL
        SELECT w.user_id, 'washer'::text, w.business_name,
               w.verification_status, w.updated_at
          FROM washer_profiles w
      )
    `;
    const where = sql`p.verification_status = ${q.status}${kindFilter}`;

    const [rows, counts] = await Promise.all([
      this.db.execute(sql`
        ${queue}
        SELECT p.user_id, p.kind, p.display_name, p.verification_status,
               to_json(p.requested_at) #>> '{}' AS requested_at,
               u.name, u.phone
          FROM partners p
          JOIN users u ON u.id = p.user_id
         WHERE ${where}
         ORDER BY p.requested_at ASC, p.user_id ASC, p.kind ASC
         LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
      `),
      this.db.execute(sql`
        ${queue}
        SELECT count(*)::int AS total FROM partners p WHERE ${where}
      `),
    ]);

    return {
      items: [...rows].map((row) => {
        const r = queueRowSchema.parse(row);
        return {
          userId: userIdSchema.parse(r.user_id),
          kind: r.kind,
          name: r.name,
          displayName: r.display_name,
          phone: maskPhone(r.phone),
          verificationStatus: r.verification_status,
          requestedAt: new Date(r.requested_at).toISOString(),
        };
      }),
      total: totalRowSchema.parse([...counts][0]).total,
    };
  }

  async detail(userId: string, kind: PartnerKind): Promise<PartnerRecord | undefined> {
    return kind === 'valet' ? this.valetDetail(userId) : this.washerDetail(userId);
  }

  private async valetDetail(userId: string): Promise<PartnerRecord | undefined> {
    const [row] = await this.db
      .select({
        userId: valetProfiles.userId,
        status: valetProfiles.verificationStatus,
        requestedAt: valetProfiles.updatedAt,
        licenceDocumentId: valetProfiles.licenceDocumentId,
        vehicleNumber: valetProfiles.vehicleNumber,
        name: users.name,
        phone: users.phone,
      })
      .from(valetProfiles)
      .innerJoin(users, eq(users.id, valetProfiles.userId))
      .where(eq(valetProfiles.userId, userId));
    if (row === undefined) return undefined;

    return {
      userId: userIdSchema.parse(row.userId),
      kind: 'valet',
      name: row.name,
      displayName: null,
      phone: maskPhone(row.phone),
      verificationStatus: verificationStatusSchema.parse(row.status),
      requestedAt: row.requestedAt.toISOString(),
      vehicleNumber: row.vehicleNumber,
      operatingHours: null,
      documentIds: { licence: row.licenceDocumentId, idProof: null, businessPhotos: [] },
    };
  }

  private async washerDetail(userId: string): Promise<PartnerRecord | undefined> {
    const [row] = await this.db
      .select({
        userId: washerProfiles.userId,
        status: washerProfiles.verificationStatus,
        requestedAt: washerProfiles.updatedAt,
        businessName: washerProfiles.businessName,
        operatingHours: washerProfiles.operatingHours,
        idDocumentId: washerProfiles.idDocumentId,
        businessPhotoIds: washerProfiles.businessPhotoIds,
        name: users.name,
        phone: users.phone,
      })
      .from(washerProfiles)
      .innerJoin(users, eq(users.id, washerProfiles.userId))
      .where(eq(washerProfiles.userId, userId));
    if (row === undefined) return undefined;

    return {
      userId: userIdSchema.parse(row.userId),
      kind: 'washer',
      name: row.name,
      displayName: row.businessName,
      phone: maskPhone(row.phone),
      verificationStatus: verificationStatusSchema.parse(row.status),
      requestedAt: row.requestedAt.toISOString(),
      vehicleNumber: null,
      operatingHours: row.operatingHours ?? null,
      documentIds: {
        licence: null,
        idProof: row.idDocumentId,
        businessPhotos: row.businessPhotoIds,
      },
    };
  }
}
