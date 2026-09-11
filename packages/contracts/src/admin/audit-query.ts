import { z } from 'zod';

import { paginationQuerySchema } from '../primitives/pagination.js';

export const auditQuerySchema = paginationQuerySchema.extend({
  tableName: z.string().min(1).optional(),
  recordId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  tableName: z.string(),
  recordId: z.string().uuid(),
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  oldData: z.record(z.unknown()).nullable(),
  newData: z.record(z.unknown()).nullable(),
  actorId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
