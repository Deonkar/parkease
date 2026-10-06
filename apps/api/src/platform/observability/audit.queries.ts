import { Inject, Injectable } from '@nestjs/common';
import type { auditEntrySchema, AuditQuery } from '@parkease/contracts/admin';
import { roleSchema } from '@parkease/contracts/enums';
import { auditLog, users } from '@parkease/db/schema';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../db/db.module.js';
import { istDayStart } from '../db/ist.js';
import {
  afterInstantCursor,
  decodeInstantCursor,
  encodeInstantCursor,
  instantText,
} from '../http/instant-cursor.js';

import { redactAuditValue } from './audit-redaction.js';

type EntryView = z.input<typeof auditEntrySchema>;

export interface AuditPage {
  readonly items: EntryView[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** `before` and `after` are jsonb: an object or null by contract, and checked rather than trusted. */
const snapshotSchema = z.record(z.unknown()).nullable();

/**
 * The audit log viewer's read side: newest first, paged by `(created_at, id)` keyset so a page
 * costs the same on row one million as on row fifty, and a row written between two requests
 * cannot shift the next page the way an OFFSET would. Redaction is applied here, on the way out:
 * the stored row stays complete, and nothing past this class sees an unredacted value.
 *
 * Lives in `platform/` beside `AuditService`, which writes the rows this reads.
 */
@Injectable()
export class AuditQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async page(q: AuditQuery): Promise<AuditPage> {
    const cursor = q.cursor === undefined ? undefined : decodeInstantCursor(q.cursor);

    const where: (SQL | undefined)[] = [
      q.actorUserId === undefined ? undefined : eq(auditLog.actorUserId, q.actorUserId),
      q.action === undefined ? undefined : eq(auditLog.action, q.action),
      q.targetType === undefined ? undefined : eq(auditLog.targetType, q.targetType),
      // A one-sided range is legal here (a filter, not a report): each end is its own bound.
      q.from === undefined ? undefined : gte(auditLog.createdAt, istDayStart(q.from)),
      q.to === undefined ? undefined : lt(auditLog.createdAt, istDayStart(q.to)),
      cursor === undefined
        ? undefined
        : afterInstantCursor(auditLog.createdAt, auditLog.id, cursor),
    ];

    // One extra row says whether there is a next page without a count. A left join: an entry whose
    // actor was never recorded (the system, a webhook) is still an entry.
    const rows = await this.db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        createdAtText: instantText(auditLog.createdAt),
        actorUserId: auditLog.actorUserId,
        actorName: users.name,
        actorRole: auditLog.actorRole,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        before: auditLog.before,
        after: auditLog.after,
        ipAddress: auditLog.ipAddress,
        traceId: auditLog.traceId,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(...where))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        actorRole: roleSchema.nullable().parse(row.actorRole),
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: snapshotSchema.parse(redactAuditValue(row.before)),
        after: snapshotSchema.parse(redactAuditValue(row.after)),
        ipAddress: row.ipAddress,
        traceId: row.traceId,
      })),
      nextCursor:
        hasMore && last !== undefined
          ? encodeInstantCursor({ occurredAt: last.createdAtText, id: last.id })
          : null,
      hasMore,
    };
  }
}
