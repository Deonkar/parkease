import {
  computeValetLegFee,
  computeWashFee,
  payoutEntries,
  reverseEntries,
  routeDischargeEntries,
  valetLegEntries,
  washEntries,
} from '@parkease/contracts/money';
import { toPaise, toRate } from '@parkease/contracts/primitives';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WasherEarningsQuery } from '../../src/domains/carwash/queries/washer-earnings.query.js';
import { LedgerService } from '../../src/domains/ledger/ledger.service.js';
import { ValetEarningsQuery } from '../../src/domains/valet/queries/valet-earnings.query.js';
import { withTransaction } from '../../src/platform/db/transaction.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * S-46: once money leaves through a rail, a partner's `owner_payable` takes a
 * debit that is a payment, not a claw-back. Every earnings figure must keep
 * reading "earned" and "taken back for cancellations" — settlement txns
 * (anything carrying a `settlement_clearing` leg) are invisible to them.
 */
describe('partner earnings ignore settlement (S-46, ADR-030)', () => {
  let h: Harness;
  const ledger = new LedgerService();
  let valets: ValetEarningsQuery;
  let washers: WasherEarningsQuery;

  beforeAll(async () => {
    h = await startHarness();
    valets = new ValetEarningsQuery(h.db);
    washers = new WasherEarningsQuery(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE ledger_entries`;
  });

  const post = (entries: Parameters<LedgerService['post']>[1]['entries']) =>
    withTransaction(h.db, async (tx) => {
      await ledger.post(tx, { entries });
    });

  it('a valet payout is not counted as reversed, and a cancellation still is', async () => {
    const valet = await seedUser(h, 'valet');
    const leg = valetLegEntries(computeValetLegFee(5000, toRate(0.2)), valet, 'valet leg');
    const cancelledFee = computeValetLegFee(3000, toRate(0.2));
    const cancelled = valetLegEntries(cancelledFee, valet, 'valet leg');
    await post(leg);
    await post(cancelled);
    await post(reverseEntries(cancelled, 'valet cancel'));
    const before = await valets.forValet(valet);

    await post(payoutEntries(toPaise(before.netPaise), valet, new Date()).entries);

    const after = await valets.forValet(valet);
    expect(after).toEqual(before);
    // The cancelled leg's earnings, and nothing else — not the payout.
    expect(after.reversedPaise).toBe(cancelledFee.valetEarningsPaise);
  });

  it('a Route-discharged wash leaves the washer summary unchanged', async () => {
    const washer = await seedUser(h, 'washer');
    const fee = computeWashFee(toPaise(39900), toRate(0.2));
    await post(washEntries(fee, washer, 'car wash service'));
    const before = (await washers.forWasher(washer, 'all')).summary;

    await post(routeDischargeEntries(fee.washerEarningsPaise, washer));

    expect((await washers.forWasher(washer, 'all')).summary).toEqual(before);
    expect(before.reversedPaise).toBe(0);
  });
});
