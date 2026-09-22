import { describe, expect, it } from 'vitest';

import {
  assertEntriesBalance,
  CARWASH_COMMISSION_RATE,
  computeWashFee,
  reverseEntries,
  washEntries,
} from '../src/money/index.js';
import { toPaise } from '../src/primitives/paise.js';

const WASHER_ID = '0192f3a1-0000-7000-8000-000000000001';
const DESCRIPTION = 'car wash service';

const fee = computeWashFee(toPaise(39900), CARWASH_COMMISSION_RATE);

describe('washEntries', () => {
  it('posts the four rows from §13.7, balanced', () => {
    const entries = washEntries(fee, WASHER_ID, DESCRIPTION);

    expect(entries).toHaveLength(4);
    expect(() => {
      assertEntriesBalance(entries);
    }).not.toThrow();
  });

  it('debits the driver the total and credits the other three', () => {
    const byAccount = Object.fromEntries(
      washEntries(fee, WASHER_ID, DESCRIPTION).map((entry) => [entry.account, entry]),
    );

    expect(byAccount['driver_receivable']).toMatchObject({
      direction: 'debit',
      amountPaise: 41336,
    });
    expect(byAccount['owner_payable']).toMatchObject({ direction: 'credit', amountPaise: 31920 });
    expect(byAccount['platform_revenue']).toMatchObject({ direction: 'credit', amountPaise: 7980 });
    expect(byAccount['gst_payable']).toMatchObject({ direction: 'credit', amountPaise: 1436 });
  });

  /**
   * §13.7. `owner_payable` is the platform's payable-to-supplier account, not an
   * owner-only one (ADR-008), so a washer's balance is the same query as an
   * owner's with a different counterparty. Tagging the whole posting instead
   * would put the washer's id on the driver's receivable and the earnings query
   * would count it twice — the bug §11.6 already documents on the valet side.
   */
  it('names the washer on owner_payable and on nothing else', () => {
    const entries = washEntries(fee, WASHER_ID, DESCRIPTION);

    for (const entry of entries) {
      if (entry.account === 'owner_payable') {
        expect(entry.counterpartyUserId).toBe(WASHER_ID);
      } else {
        expect(entry.counterpartyUserId).toBeUndefined();
      }
    }
  });

  it('carries the description onto every row', () => {
    for (const entry of washEntries(fee, WASHER_ID, DESCRIPTION)) {
      expect(entry.description).toBe(DESCRIPTION);
    }
  });
});

describe('reversing a wash posting', () => {
  const reversed = reverseEntries(
    washEntries(fee, WASHER_ID, DESCRIPTION),
    'car wash cancellation reversal',
  );

  it('balances at the same total', () => {
    expect(() => {
      assertEntriesBalance(reversed);
    }).not.toThrow();
    const debits = reversed
      .filter((entry) => entry.direction === 'debit')
      .reduce((sum, entry) => sum + entry.amountPaise, 0);
    expect(debits).toBe(fee.driverTotalPaise);
  });

  /**
   * A reversal that drops the counterparty credits the washer and debits
   * nobody, so their earnings balance never comes back down — and the ledger
   * still "balances" while owing a partner money for a wash that never happened.
   */
  it('keeps the washer on the reversed owner_payable leg', () => {
    const ownerLeg = reversed.find((entry) => entry.account === 'owner_payable');
    expect(ownerLeg).toMatchObject({ direction: 'debit', counterpartyUserId: WASHER_ID });
  });
});
