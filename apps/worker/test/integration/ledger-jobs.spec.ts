import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { assertLedgerBalance } from '../../src/jobs/ledger/assert-balance.job.js';
import { logger } from '../../src/logger.js';

/**
 * Task 21 §21.3 #16: deliberately insert an unbalanced `txn_id` and the job must say so.
 *
 * The one-sided posting is the case that matters. `sum(...) FILTER (...)` over no rows is NULL,
 * not 0, and `NULL <> 900` is NULL rather than true — so a HAVING without coalesce drops exactly
 * the txn that has debits and no credits at all. That is a lost leg, the most likely shape a real
 * imbalance takes, and the first version of this job could not see it.
 */
describe('ledger.assert-balance', () => {
  let pg: PgTestContext;
  let deps: JobDeps;

  beforeAll(async () => {
    pg = await startPgContainer();
    await runMigrations(pg.connectionString);
    deps = {
      db: drizzle(pg.sql) as unknown as JobDeps['db'],
      boss: undefined as unknown as JobDeps['boss'],
      redis: undefined as unknown as JobDeps['redis'],
    };
  }, 300_000);

  afterAll(async () => {
    await stopPgContainer(pg);
  });

  const post = async (
    legs: readonly { account: string; direction: 'debit' | 'credit'; amount: number }[],
  ): Promise<string> => {
    const txnId = crypto.randomUUID();
    for (const leg of legs) {
      await pg.sql`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
        VALUES (${txnId}, ${leg.account}, ${leg.direction}, ${leg.amount}, 'task 21 #16')`;
    }
    return txnId;
  };

  it('reports nothing, and logs nothing fatal, when every posting balances', async () => {
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    await post([
      { account: 'driver_receivable', direction: 'debit', amount: 6162 },
      { account: 'owner_payable', direction: 'credit', amount: 5100 },
      { account: 'platform_revenue', direction: 'credit', amount: 900 },
      { account: 'gst_payable', direction: 'credit', amount: 162 },
    ]);

    await expect(assertLedgerBalance(deps)).resolves.toEqual([]);
    expect(fatal).not.toHaveBeenCalled();
    fatal.mockRestore();
  });

  it('catches a posting whose debits and credits disagree', async () => {
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    const txnId = await post([
      { account: 'driver_receivable', direction: 'debit', amount: 6162 },
      { account: 'owner_payable', direction: 'credit', amount: 5100 },
    ]);

    await expect(assertLedgerBalance(deps)).resolves.toEqual([txnId]);
    expect(fatal).toHaveBeenCalledWith({ txnIds: [txnId] }, 'LEDGER_IMBALANCE');
    fatal.mockRestore();
  });

  it('catches a one-sided posting, which has no credits to compare against', async () => {
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    const debitOnly = await post([
      { account: 'driver_receivable', direction: 'debit', amount: 900 },
    ]);
    const creditOnly = await post([{ account: 'owner_payable', direction: 'credit', amount: 900 }]);

    const found = await assertLedgerBalance(deps);

    expect(found).toEqual(expect.arrayContaining([debitOnly, creditOnly]));
    expect(fatal).toHaveBeenCalledTimes(1);
    fatal.mockRestore();
  });
});
