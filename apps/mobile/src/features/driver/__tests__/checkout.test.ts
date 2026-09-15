import { describe, expect, it } from 'vitest';

import { buildCheckoutOptions, CHECKOUT_HTML, checkoutResultSchema } from '../checkout-html';
import { formatCountdown } from '../hooks/useCountdown';

const params = {
  keyId: 'rzp_test_fake0000000000',
  razorpayOrderId: 'order_QK7xVv9pLm2Zab',
  amountPaise: 9702,
  spaceTitle: 'Basement Parking, 5th Cross',
  themeColor: '#0369A1',
  prefill: { name: 'Ravi K.', contact: '+919812345678' },
};

describe('buildCheckoutOptions', () => {
  it('hands Razorpay the order id and the amount the server fixed', () => {
    const options = buildCheckoutOptions(params);

    expect(options.order_id).toBe('order_QK7xVv9pLm2Zab');
    expect(options.amount).toBe(9702);
    expect(options.currency).toBe('INR');
  });

  it('uses the publishable key id', () => {
    expect(buildCheckoutOptions(params).key).toBe('rzp_test_fake0000000000');
  });

  it('themes Checkout with the token colour, not orange', () => {
    // Task 9's mock says "brand orange #FF5500". Orange was a direction that
    // was not chosen, and CLAUDE.md rejects it.
    expect(buildCheckoutOptions(params).theme.color).toBe('#0369A1');
  });

  it('omits the method key entirely when none is given, so Razorpay shows its picker', () => {
    expect(buildCheckoutOptions(params).method).toBeUndefined();
  });

  it('prefills a method when one is given, so a retry opens where it failed', () => {
    expect(buildCheckoutOptions({ ...params, method: 'upi' }).method).toEqual({ upi: true });
  });

  it('carries an owner-supplied title as data, never as markup', () => {
    // The finding that reshaped this module. Interpolating the title into a
    // <script> block let `</script><script>…` close the block, because
    // JSON.stringify escapes quotes but leaves `<` alone — a genuine cross-user
    // injection, since space titles are written by owners. The options now
    // travel through the WebView's own typed channel, so the title is a string
    // in an object and there is nothing left to escape.
    const hostile = '</script><script>alert(1)</script>';
    const options = buildCheckoutOptions({ ...params, spaceTitle: hostile });

    expect(options.description).toBe(hostile);
    expect(CHECKOUT_HTML).not.toContain(hostile);
  });
});

describe('CHECKOUT_HTML', () => {
  it('is static — no booking, no amount, no title, nothing to escape', () => {
    expect(CHECKOUT_HTML).not.toContain('order_QK7xVv9pLm2Zab');
    expect(CHECKOUT_HTML).not.toContain('9702');
    expect(CHECKOUT_HTML).not.toContain('Basement Parking');
  });

  it('carries no secret of any kind', () => {
    expect(CHECKOUT_HTML).not.toMatch(/key_secret|webhook_secret|rzp_live/i);
  });

  it('reads its options from the injected channel', () => {
    expect(CHECKOUT_HTML).toContain('bridge.injectedObjectJson()');
  });

  it('sends exactly one message per checkout', () => {
    // Razorpay fires `ondismiss` after a failure too. A second message would
    // reopen a sheet the screen has already moved past.
    expect(CHECKOUT_HTML).toContain('if (sent) return;');
    expect(CHECKOUT_HTML).toContain('sent = true;');
  });

  it('reports a checkout that could not open at all, rather than an empty WebView', () => {
    expect(CHECKOUT_HTML).toContain("send({ type: 'failed'");
  });
});

describe('checkoutResultSchema', () => {
  it('accepts a success carrying all three Razorpay fields', () => {
    const parsed = checkoutResultSchema.parse({
      type: 'success',
      razorpayOrderId: 'order_QK7xVv9pLm2Zab',
      razorpayPaymentId: 'pay_abc123',
      razorpaySignature: 'a'.repeat(64),
    });

    expect(parsed.type).toBe('success');
  });

  it('rejects a success missing its signature', () => {
    expect(() =>
      checkoutResultSchema.parse({
        type: 'success',
        razorpayOrderId: 'order_x',
        razorpayPaymentId: 'pay_x',
      }),
    ).toThrow();
  });

  it('ignores an amount the page tries to report', () => {
    // The client cannot influence what we believe was paid: the server
    // re-fetches the order from Razorpay (R-SEC-09). The schema simply has
    // nowhere to put this.
    const parsed = checkoutResultSchema.parse({
      type: 'success',
      razorpayOrderId: 'order_x',
      razorpayPaymentId: 'pay_x',
      razorpaySignature: 'sig',
      amountPaise: 1,
    });

    expect(parsed).not.toHaveProperty('amountPaise');
  });

  it('accepts a failure with or without a method', () => {
    expect(checkoutResultSchema.parse({ type: 'failed' })).toEqual({ type: 'failed' });
    expect(
      checkoutResultSchema.parse({ type: 'failed', reason: 'declined', method: 'upi' }),
    ).toMatchObject({ method: 'upi' });
  });

  it('accepts a dismissal', () => {
    expect(checkoutResultSchema.parse({ type: 'dismissed' })).toEqual({ type: 'dismissed' });
  });

  it('rejects anything it does not recognise', () => {
    for (const bad of [{ type: 'whatever' }, {}, null, 'success', 42]) {
      expect(() => checkoutResultSchema.parse(bad)).toThrow();
    }
  });

  it('caps field lengths, so a hostile page cannot post a megabyte', () => {
    expect(() =>
      checkoutResultSchema.parse({
        type: 'success',
        razorpayOrderId: 'x'.repeat(65),
        razorpayPaymentId: 'pay_x',
        razorpaySignature: 'sig',
      }),
    ).toThrow();
  });
});

describe('formatCountdown', () => {
  it('pads the seconds so the label does not jitter', () => {
    expect(formatCountdown(9 * 60_000 + 41_000)).toBe('9:41');
    expect(formatCountdown(60_000 + 5_000)).toBe('1:05');
    expect(formatCountdown(9_000)).toBe('0:09');
  });

  it('floors rather than rounds, so it never shows a second that has passed', () => {
    expect(formatCountdown(1_999)).toBe('0:01');
  });

  it('reads zero at zero', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });
});
