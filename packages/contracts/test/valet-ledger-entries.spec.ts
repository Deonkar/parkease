import { describe, expect, it } from 'vitest';

import {
  assertEntriesBalance,
  computeValetLegFee,
  computeValetNoShowFee,
  type LedgerEntryDraft,
  VALET_COMMISSION_RATE,
  valetChargeAdjustmentEntries,
  valetLegEntries,
} from '../src/money/index.js';

const rate = VALET_COMMISSION_RATE;
const VALET = '0192f0a1-0000-7000-8000-000000000001';

const byAccount = (
  entries: readonly LedgerEntryDraft[],
): Partial<Record<string, LedgerEntryDraft>> =>
  Object.fromEntries(entries.map((e) => [e.account, e]));

describe('valetLegEntries', () => {
  const outbound = valetLegEntries(computeValetLegFee(3200, rate), VALET, 'valet outbound leg');

  it('posts the four rows in §11.6 with the paise from the worked example', () => {
    const rows = byAccount(outbound);

    expect(rows['driver_receivable']).toMatchObject({ direction: 'debit', amountPaise: 9324 });
    expect(rows['owner_payable']).toMatchObject({ direction: 'credit', amountPaise: 7200 });
    expect(rows['platform_revenue']).toMatchObject({ direction: 'credit', amountPaise: 1800 });
    expect(rows['gst_payable']).toMatchObject({ direction: 'credit', amountPaise: 324 });
  });

  it('balances', () => {
    expect(() => assertEntriesBalance(outbound)).not.toThrow();
  });

  /**
   * The valet's balance is `owner_payable` filtered by counterparty, exactly as
   * an owner's is. Tagging the whole posting instead would put the valet's id on
   * the driver's receivable too, and the earnings query would double-count.
   */
  it('tags only the valet earnings row with the valet as counterparty', () => {
    const rows = byAccount(outbound);

    expect(rows['owner_payable']).toMatchObject({ counterpartyUserId: VALET });
    expect(rows['driver_receivable']?.counterpartyUserId).toBeUndefined();
    expect(rows['platform_revenue']?.counterpartyUserId).toBeUndefined();
    expect(rows['gst_payable']?.counterpartyUserId).toBeUndefined();
  });

  it('prices the return leg to the §11.6 return example', () => {
    const rows = byAccount(valetLegEntries(computeValetLegFee(2400, rate), VALET, 'return'));

    expect(rows['driver_receivable']).toMatchObject({ amountPaise: 8288 });
    expect(rows['owner_payable']).toMatchObject({ amountPaise: 6400 });
    expect(rows['platform_revenue']).toMatchObject({ amountPaise: 1600 });
    expect(rows['gst_payable']).toMatchObject({ amountPaise: 288 });
  });
});

describe('valetChargeAdjustmentEntries', () => {
  const charged = computeValetLegFee(3200, rate);
  const retained = computeValetNoShowFee(rate);
  const adjustment = valetChargeAdjustmentEntries(charged, retained, VALET, 'valet no-show');

  it('reverses the difference rather than charging the call-out again', () => {
    const rows = byAccount(adjustment);

    expect(rows['owner_payable']).toMatchObject({ direction: 'debit', amountPaise: 3200 });
    expect(rows['platform_revenue']).toMatchObject({ direction: 'debit', amountPaise: 800 });
    expect(rows['gst_payable']).toMatchObject({ direction: 'debit', amountPaise: 144 });
    expect(rows['refunds_payable']).toMatchObject({ direction: 'credit', amountPaise: 4144 });
  });

  it('balances', () => {
    expect(() => assertEntriesBalance(adjustment)).not.toThrow();
  });

  it('leaves the driver net at the call-out fee across both postings', () => {
    const chargedDebit = charged.driverTotalPaise;
    const refunded = adjustment.find((e) => e.account === 'refunds_payable')?.amountPaise ?? 0;

    expect(chargedDebit - refunded).toBe(retained.driverTotalPaise);
    expect(chargedDebit - refunded).toBe(5180);
  });

  it('debits the valet, not the platform, for the earnings being clawed back', () => {
    expect(byAccount(adjustment)['owner_payable']).toMatchObject({ counterpartyUserId: VALET });
  });

  /**
   * A zero-distance leg is charged at exactly the call-out fee, so there is
   * nothing to give back. An empty posting is the correct answer and the caller
   * must skip it — `assertEntriesBalance` rejects a posting with no entries, so
   * returning a "balanced" zero set would abort the transaction.
   */
  it('returns nothing when the charge already equals what is retained', () => {
    const zero = computeValetLegFee(0, rate);
    expect(valetChargeAdjustmentEntries(zero, retained, VALET, 'no-op')).toEqual([]);
  });

  it('refuses to refund more than was charged', () => {
    const small = computeValetLegFee(0, rate);
    const large = computeValetLegFee(9000, rate);
    expect(() => valetChargeAdjustmentEntries(small, large, VALET, 'inverted')).toThrow(RangeError);
  });
});
