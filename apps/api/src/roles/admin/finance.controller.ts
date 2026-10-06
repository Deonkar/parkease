import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import {
  adminPayoutSchema,
  dateRangeSchema,
  financeBalancesSchema,
  ledgerEntrySchema,
  ledgerExportQuerySchema,
  ledgerQuerySchema,
  payoutsQuerySchema,
  reconciliationItemSchema,
  reconciliationQuerySchema,
} from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { cursorPageOf, offsetPageOf } from '@parkease/contracts/primitives';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { FinanceBalancesQuery, istRange } from '../../domains/ledger/queries/account-totals.js';
import { LedgerExplorerQuery } from '../../domains/ledger/queries/ledger-explorer.js';
import { LedgerExportStream } from '../../domains/ledger/queries/ledger-export.js';
import { AdminPayoutQueries } from '../../domains/payout/admin-payout.queries.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const ledgerPageSchema = cursorPageOf(ledgerEntrySchema);
const payoutsPageSchema = offsetPageOf(adminPayoutSchema);
const reconciliationSchema = z.array(reconciliationItemSchema);

/**
 * The money screens, read-only. Balances, the explorer and the export all read `ledger_entries`;
 * payouts and reconciliation read what the weekly job and the nightly check wrote about it.
 * Nothing here writes, so nothing here is audited: an admin looking at the ledger changes no state.
 */
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminFinanceController {
  constructor(
    private readonly balances: FinanceBalancesQuery,
    private readonly explorer: LedgerExplorerQuery,
    private readonly exporter: LedgerExportStream,
    private readonly payouts: AdminPayoutQueries,
  ) {}

  @Get('finance/balances')
  async balancesFor(@Query() query: unknown) {
    const { from, to } = dateRangeSchema.parse(query ?? {});
    return parseOutgoing(
      financeBalancesSchema,
      await this.balances.read(from, to),
      'finance balances',
    );
  }

  @Get('ledger')
  async ledger(@Query() query: unknown) {
    const q = ledgerQuerySchema.parse(query ?? {});
    return parseOutgoing(ledgerPageSchema, await this.explorer.page(q), 'ledger page');
  }

  /**
   * Streamed, so it takes the raw reply and is NOT wrapped in the `{data}` envelope: a CSV file
   * is not JSON. Everything that can fail with a proper JSON error does so before the first byte:
   * the guards run before this handler, and the query is validated before a header is set. After
   * the first byte a failure can only destroy the response (see `streamLedgerCsv`).
   *
   * The filename is built from two dates that already passed `z.string().date()`, which cannot
   * contain a quote, a newline or a semicolon: there is nothing to inject into the header.
   */
  @Get('ledger/export')
  async export(
    @Query() query: unknown,
    @Res() reply: FastifyReply,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const { from, to } = ledgerExportQuerySchema.parse(query ?? {});
    // Opened (cap checked, audit row written) before any header, so a 429 is still JSON.
    const stream = await this.exporter.open(
      istRange(from, to),
      { from, to },
      {
        userId: user.id,
        ipAddress: request.ip,
      },
    );

    void reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ledger-${from}-${to}.csv"`)
      .header('cache-control', 'no-store')
      .send(stream);
  }

  @Get('payouts')
  async payoutList(@Query() query: unknown) {
    const q = payoutsQuerySchema.parse(query ?? {});
    const { items, total } = await this.payouts.list(q);
    return parseOutgoing(
      payoutsPageSchema,
      { items, meta: { page: q.page, pageSize: q.pageSize, total } },
      'admin payouts',
    );
  }

  @Get('reconciliation')
  async reconciliation(@Query() query: unknown) {
    const { from, to } = reconciliationQuerySchema.parse(query ?? {});
    return parseOutgoing(
      reconciliationSchema,
      await this.payouts.reconciliation(istRange(from, to)),
      'reconciliation mismatches',
    );
  }
}
