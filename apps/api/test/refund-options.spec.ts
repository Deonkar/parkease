import type { AdminRefund } from '@parkease/contracts/admin';
import { RefundTier } from '@parkease/contracts/money';
import { toPaise } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import { RefundExceedsBalanceError } from '../src/domains/payment/errors.js';
import {
  isAdminRefundable,
  refundableOf,
  refundOptions,
  resolveAdminRefund,
} from '../src/domains/payment/refund-options.js';

const reason = 'driver charged twice';

describe('refundOptions', () => {
  it('offers the fee-less full amount and half of a 9702 balance', () => {
    expect(refundOptions(toPaise(9702))).toEqual([
      { option: 'full_minus_fee', amountPaise: 8702 },
      { option: 'half', amountPaise: 4851 },
    ]);
  });

  it('drops full_minus_fee when the fee would eat the whole balance', () => {
    expect(refundOptions(toPaise(800))).toEqual([{ option: 'half', amountPaise: 400 }]);
  });

  it('offers nothing against an empty balance', () => {
    expect(refundOptions(toPaise(0))).toEqual([]);
  });

  it('drops half when it rounds down to zero', () => {
    expect(refundOptions(toPaise(1))).toEqual([]);
  });

  it('never offers custom: the client supplies that amount', () => {
    expect(refundOptions(toPaise(50_000)).map((o) => o.option)).not.toContain('custom');
  });
});

describe('resolveAdminRefund', () => {
  const custom = (amountPaise: number): AdminRefund => ({
    option: 'custom',
    amountPaise: toPaise(amountPaise),
    reason,
  });

  it('resolves the presets to what refundOptions offered', () => {
    expect(resolveAdminRefund({ option: 'full_minus_fee', reason }, toPaise(9702))).toBe(8702);
    expect(resolveAdminRefund({ option: 'half', reason }, toPaise(9702))).toBe(4851);
  });

  it('accepts a custom amount up to and including the balance', () => {
    expect(resolveAdminRefund(custom(9702), toPaise(9702))).toBe(9702);
    expect(resolveAdminRefund(custom(1), toPaise(9702))).toBe(1);
  });

  it('refuses a custom amount over the balance', () => {
    expect(() => resolveAdminRefund(custom(9703), toPaise(9702))).toThrow(
      RefundExceedsBalanceError,
    );
  });

  it('refuses a custom amount of zero', () => {
    expect(() => resolveAdminRefund(custom(0), toPaise(9702))).toThrow(RefundExceedsBalanceError);
  });

  it('refuses a preset that would refund nothing', () => {
    expect(() => resolveAdminRefund({ option: 'full_minus_fee', reason }, toPaise(800))).toThrow(
      RefundExceedsBalanceError,
    );
    expect(() => resolveAdminRefund({ option: 'half', reason }, toPaise(0))).toThrow(
      RefundExceedsBalanceError,
    );
  });

  it('answers 422 REFUND_EXCEEDS_BALANCE', () => {
    const error = new RefundExceedsBalanceError();
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ error: 'REFUND_EXCEEDS_BALANCE' });
  });
});

describe('refundableOf', () => {
  it('is the capture less every refund already issued', () => {
    expect(
      refundableOf(9702, [
        { amountPaise: 8702, reason: 'admin' },
        { amountPaise: 500, reason: 'admin' },
      ]),
    ).toBe(500);
  });

  it('is the whole capture when nothing was refunded', () => {
    expect(refundableOf(9702, [])).toBe(9702);
  });

  it.each([RefundTier.BEFORE_START, RefundTier.OWNER_CANCELLED])(
    'is zero once a %s cancellation reversed the booking in full',
    (tier) => {
      // before_start keeps ₹10, but the posting already re-recognised it as revenue: a
      // proportional refund on top would debit owner and tax a second time.
      expect(refundableOf(9702, [{ amountPaise: 8702, reason: tier }])).toBe(0);
    },
  );

  it('leaves the unrefunded half of an active_grace cancellation refundable', () => {
    expect(refundableOf(9702, [{ amountPaise: 4851, reason: RefundTier.ACTIVE_GRACE }])).toBe(4851);
  });

  it('fails loudly when refunds exceed the capture', () => {
    expect(() => refundableOf(100, [{ amountPaise: 101, reason: 'admin' }])).toThrow();
  });
});

describe('isAdminRefundable', () => {
  it.each(['completed', 'no_show', 'cancelled'])('allows a settled %s booking', (status) => {
    expect(isAdminRefundable(status)).toBe(true);
  });

  it.each(['pending_payment', 'confirmed', 'active', 'expired'])(
    'refuses a %s booking',
    (status) => {
      expect(isAdminRefundable(status)).toBe(false);
    },
  );
});
