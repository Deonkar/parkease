import { Controller, Get, Query } from '@nestjs/common';
import { auditEntrySchema, auditQuerySchema } from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { cursorPageOf } from '@parkease/contracts/primitives';

import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { AuditQueries } from '../../platform/observability/audit.queries.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const auditPageSchema = cursorPageOf(auditEntrySchema);

/**
 * The audit log, read-only. Reading it writes nothing, so nothing here is itself audited.
 * Redaction is the query's job, not this controller's: there is no path to an unredacted row.
 */
@Controller('admin/audit')
@Roles(Role.ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditQueries) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = auditQuerySchema.parse(query ?? {});
    const { items, hasMore, nextCursor } = await this.audit.page(q);
    return parseOutgoing(
      auditPageSchema,
      { items, meta: { limit: q.limit, hasMore, nextCursor } },
      'audit log page',
    );
  }
}
