import { describe, expect, it } from 'vitest';

import {
  assertEntriesBalance,
  type DatedRate,
  draftsFromLedgerRows,
  payoutEntries,
  routeDischargeEntries,
  settlementClearedEntries,
  TCS_RATE_HISTORY,
} from '../src/money/index.js';
import { toPaise, toRate } from '../src/primitives/paise.js';

const VALET = '0190a1b2-0000-7000-8000-000000000001';
const AT = new Date('2026-06-15T06:00:00+05:30');

const sum = (
  entries: readonly { account: string; direction: string; amountPaise: number }[],
  account: string,
  direction: 'debit' | 'credit',
) =>
  entries
    .filter((e) => e.account === account && e.direction === direction)
    .reduce((total, e) => total + e.amountPaise, 0);

const onePercentFrom2027: readonly DatedRate[] = [
  { rate: toRate(0), effectiveFrom: '2026-01-01', note: 'pending CA' },
  { rate: toRate(0.01), effectiveFrom: '2027-01-01', note: 'test: CA says 1%' },
];

describe('routeDischargeEntries', () => {
  it('debits owner_payable against the counterparty and credits settlement_clearing', () => {
    const entries = routeDischargeEntries(5100, VALET);

    assertEntriesBalance(entries);
    expect(entries).toEqual([
      expect.objectContaining({
        account: 'owner_payable',
        direction: 'debit',
        amountPaise: 5100,
        counterpartyUserId: VALET,
      }),
      expect.objectContaining({
        account: 'settlement_clearing',
        direction: 'credit',
        amountPaise: 5100,
      }),
    ]);
    // The clearing leg belongs to nobody, or the earnings query would count it.
    expect(entries[1]).not.toHaveProperty('counterpartyUserId');
  });
});

describe('settlementClearedEntries', () => {
  it('moves the confirmed amount out of settlement_clearing against driver_receivable', () => {
    const entries = settlementClearedEntries(5100);

    assertEntriesBalance(entries);
    expect(sum(entries, 'settlement_clearing', 'debit')).toBe(5100);
    expect(sum(entries, 'driver_receivable', 'credit')).toBe(5100);
  });
});

describe('draftsFromLedgerRows', () => {
  it('rebuilds a stored posting so it can be reversed, counterparty kept', () => {
    const drafts = draftsFromLedgerRows([
      {
        account: 'owner_payable',
        direction: 'debit',
        amountPaise: 900,
        description: 'payout',
        counterpartyUserId: VALET,
      },
      {
        account: 'settlement_clearing',
        direction: 'credit',
        amountPaise: 900,
        description: 'payout',
        counterpartyUserId: null,
      },
    ]);

    expect(drafts).toEqual([
      {
        account: 'owner_payable',
        direction: 'debit',
        amountPaise: 900,
        description: 'payout',
        counterpartyUserId: VALET,
      },
      {
        account: 'settlement_clearing',
        direction: 'credit',
        amountPaise: 900,
        description: 'payout',
      },
    ]);
  });

  it('refuses an account the chart does not have, instead of posting it', () => {
    expect(() =>
      draftsFromLedgerRows([
        {
          account: 'cash',
          direction: 'debit',
          amountPaise: 1,
          description: 'x',
          counterpartyUserId: null,
        },
      ]),
    ).toThrow();
  });
});

describe('payoutEntries', () => {
  it('at rate 0 writes exactly two legs and pays the whole balance', () => {
    const payout = payoutEntries(toPaise(320_000), VALET, AT);

    assertEntriesBalance(payout.entries);
    expect(payout.entries).toHaveLength(2);
    expect(payout).toMatchObject({ tcsPaise: 0, tdsPaise: 0, netPaise: 320_000 });
    expect(sum(payout.entries, 'owner_payable', 'debit')).toBe(320_000);
    expect(sum(payout.entries, 'settlement_clearing', 'credit')).toBe(320_000);
    expect(payout.entries[0]).toMatchObject({ counterpartyUserId: VALET });
  });

  it('withholds TCS and TDS at 1% each: 3200 + 3200 + 313600 = 320000', () => {
    const payout = payoutEntries(toPaise(320_000), VALET, new Date('2027-01-04T06:00:00+05:30'), {
      tcs: onePercentFrom2027,
      tds: onePercentFrom2027,
    });

    assertEntriesBalance(payout.entries);
    expect(payout).toMatchObject({ tcsPaise: 3200, tdsPaise: 3200, netPaise: 313_600 });
    expect(sum(payout.entries, 'tcs_payable', 'credit')).toBe(3200);
    expect(sum(payout.entries, 'tds_payable', 'credit')).toBe(3200);
    expect(sum(payout.entries, 'settlement_clearing', 'credit')).toBe(313_600);
  });

  it('reads the rate in force at the payout date, so a CA change is config, not code', () => {
    const rates = { tcs: onePercentFrom2027, tds: TCS_RATE_HISTORY };

    const before = payoutEntries(
      toPaise(320_000),
      VALET,
      new Date('2026-12-31T23:00:00+05:30'),
      rates,
    );
    const after = payoutEntries(
      toPaise(320_000),
      VALET,
      new Date('2027-01-01T00:00:00+05:30'),
      rates,
    );

    expect(before.tcsPaise).toBe(0);
    expect(after.tcsPaise).toBe(3200);
  });
});
