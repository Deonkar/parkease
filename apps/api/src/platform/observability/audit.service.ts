import { Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { auditLog } from '@parkease/db/schema';

import { DB, type Database } from '../db/db.module.js';
import type { TxHandle } from '../db/transaction.js';

export interface AuditEntry {
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly ipAddress: string | null;
}

/**
 * The admin behind a request, carried down from the controller: the IP belongs to the connection
 * and the audit row is written inside the command, three layers below it. Every admin command
 * takes one of these (the audit row's role is always `admin`, so it is not carried).
 */
export interface AdminActor {
  readonly userId: string;
  readonly ipAddress: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(tx: TxHandle, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: entry.ipAddress,
      traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
    });
  }
}
