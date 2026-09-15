import { describe, expect, it } from 'vitest';

import { LedgerAccount } from '../src/enums/index.js';
import {
  assertEntriesBalance,
  bookingReceivableEntries,
  reverseEntries,
  UnbalancedLedgerError,
} from '../src/money/ledger-entries.js';
import { quote } from '../src/money/quote.js';
import { toPaise, toRate } from '../src/primitives/paise.js';

/** The worked example from task 8: 2 hours at ₹30, 1.5x surge. */
const WORKED_EXAMPLE = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });

const sumOf = (
  entries: readonly { direction: string; amountPaise: number }[],
  direction: string,
): number =>
  entries
    .filter((entry) => entry.direction === direction)
    .reduce((total, entry) => total + entry.amountPaise, 0);

describe('bookingReceivableEntries', () => {
  const entries = bookingReceivableEntries(WORKED_EXAMPLE);

  it('reproduces the worked example, to the paise', () => {
    expect(WORKED_EXAMPLE.basePaise).toBe(6000);
    expect(WORKED_EXAMPLE.surgePremiumPaise).toBe(3000);
    expect(WORKED_EXAMPLE.gstPaise).toBe(702);
    expect(WORKED_EXAMPLE.driverTotalPaise).toBe(9702);
    expect(WORKED_EXAMPLE.ownerEarningsPaise).toBe(5100);
    expect(WORKED_EXAMPLE.parkeaseFeePaise).toBe(3900);
  });

  it('balances: debits equal credits', () => {
    expect(sumOf(entries, 'debit')).toBe(sumOf(entries, 'credit'));
  });

  it('debits the whole driver total to the receivable', () => {
    const debits = entries.filter((entry) => entry.direction === 'debit');
    expect(debits).toHaveLength(1);
    expect(debits[0]?.account).toBe(LedgerAccount.DRIVER_RECEIVABLE);
    expect(debits[0]?.amountPaise).toBe(9702);
  });

  it('splits the credits three ways: owner, platform, tax', () => {
    const credits = Object.fromEntries(
      entries
        .filter((entry) => entry.direction === 'credit')
        .map((entry) => [entry.account, entry.amountPaise]),
    );
    expect(credits).toEqual({
      [LedgerAccount.OWNER_PAYABLE]: 5100,
      [LedgerAccount.PLATFORM_REVENUE]: 3900,
      [LedgerAccount.GST_PAYABLE]: 702,
    });
  });

  it('omits a zero-amount leg rather than writing one the CHECK would reject', () => {
    // ledger_entries_amount_check is `amount_paise > 0`. A free booking would
    // otherwise try to write a zero GST leg and fail the insert.
    const free = quote({ basePaise: toPaise(0), surgeMultiplier: toRate(1) });
    const entries = bookingReceivableEntries(free);
    expect(entries.every((entry) => entry.amountPaise > 0)).toBe(true);
  });

  it('never surges below 1x, so the premium leg is absent at base price', () => {
    const noSurge = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1) });
    const entries = bookingReceivableEntries(noSurge);
    expect(sumOf(entries, 'debit')).toBe(noSurge.driverTotalPaise);
    expect(sumOf(entries, 'debit')).toBe(sumOf(entries, 'credit'));
  });
});

describe('reverseEntries', () => {
  const original = bookingReceivableEntries(WORKED_EXAMPLE);
  const reversal = reverseEntries(original, 'booking cancelled');

  it('flips every direction and keeps every amount', () => {
    expect(reversal).toHaveLength(original.length);
    for (const [index, entry] of reversal.entries()) {
      const source = original[index];
      expect(entry.account).toBe(source?.account);
      expect(entry.amountPaise).toBe(source?.amountPaise);
      expect(entry.direction).toBe(source?.direction === 'debit' ? 'credit' : 'debit');
    }
  });

  it('balances', () => {
    expect(sumOf(reversal, 'debit')).toBe(sumOf(reversal, 'credit'));
  });

  it('nets the two postings to zero on every account', () => {
    const net = new Map<string, number>();
    for (const entry of [...original, ...reversal]) {
      const signed = entry.direction === 'debit' ? entry.amountPaise : -entry.amountPaise;
      net.set(entry.account, (net.get(entry.account) ?? 0) + signed);
    }
    for (const balance of net.values()) expect(balance).toBe(0);
  });

  it('carries its own description, so the ledger reads as a story', () => {
    expect(reversal.every((entry) => entry.description === 'booking cancelled')).toBe(true);
  });
});

describe('assertEntriesBalance', () => {
  it('accepts a balanced posting', () => {
    expect(() => {
      assertEntriesBalance(bookingReceivableEntries(WORKED_EXAMPLE));
    }).not.toThrow();
  });

  it('rejects a posting whose debits and credits differ', () => {
    const skewed = [
      {
        account: LedgerAccount.DRIVER_RECEIVABLE,
        direction: 'debit',
        amountPaise: 100,
        description: 'x',
      },
      {
        account: LedgerAccount.OWNER_PAYABLE,
        direction: 'credit',
        amountPaise: 99,
        description: 'x',
      },
    ] as const;
    expect(() => {
      assertEntriesBalance(skewed);
    }).toThrow(UnbalancedLedgerError);
  });

  it('rejects an empty posting, which is a silently dropped write', () => {
    expect(() => {
      assertEntriesBalance([]);
    }).toThrow(UnbalancedLedgerError);
  });

  it('rejects a non-positive amount the CHECK constraint would reject anyway', () => {
    const zeroed = [
      {
        account: LedgerAccount.DRIVER_RECEIVABLE,
        direction: 'debit',
        amountPaise: 0,
        description: 'x',
      },
      {
        account: LedgerAccount.OWNER_PAYABLE,
        direction: 'credit',
        amountPaise: 0,
        description: 'x',
      },
    ] as const;
    expect(() => {
      assertEntriesBalance(zeroed);
    }).toThrow(UnbalancedLedgerError);
  });
});
