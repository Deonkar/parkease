import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { userIdSchema } from '../primitives/ids.js';

import { refineDateRange } from './finance.js';
import { adminCursorQuerySchema, istDateSchema } from './query.js';

/** A one-sided range is a filter; a closed one obeys the same bounds as every finance query. */
export const auditQuerySchema = adminCursorQuerySchema
  .extend({
    actorUserId: userIdSchema.optional(),
    action: z.string().trim().min(1).max(100).optional(),
    targetType: z.string().trim().min(1).max(50).optional(),
    from: istDateSchema.optional(),
    to: istDateSchema.optional(),
  })
  .superRefine(refineDateRange);

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  actorUserId: userIdSchema.nullable(),
  actorName: z.string().nullable(),
  actorRole: roleSchema.nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  traceId: z.string().nullable(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
