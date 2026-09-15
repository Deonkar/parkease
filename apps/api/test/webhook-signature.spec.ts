import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidWebhookSignatureError } from '../src/domains/payment/errors.js';
import { VerificationService } from '../src/domains/payment/verification.service.js';

const WEBHOOK_SECRET = 'fake_webhook_secret_000';
const KEY_SECRET = 'fakesecretfakesecret00';

const sign = (body: string, secret = WEBHOOK_SECRET): string =>
  createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');

/**
 * Spaced exactly as a sender might emit it. The bytes are the contract, so this
 * string — not the object it denotes — is what gets signed.
 *
 * Note what is *not* varied here: key order. `JSON.stringify(JSON.parse(s))`
 * preserves insertion order, so a round trip never reorders keys, and a test
 * built on that premise asserts nothing. What a round trip really destroys is
 * whitespace, unicode escaping and number formatting — which is what actually
 * broke v1 against live traffic, and what is asserted below.
 */
const BODY =
  '{"entity": "event", "event": "payment.captured", "payload": {"payment": {"entity": {"order_id": "order_QK7xVv9pLm2Zab", "amount": 9702}}}}';

describe('verifyWebhookSignature', () => {
  const service = new VerificationService();
  const verify = (body: string, signature: unknown): void => {
    service.verifyWebhookSignature(Buffer.from(body, 'utf8'), signature);
  };

  it('accepts a signature over the exact bytes', () => {
    expect(() => {
      verify(BODY, sign(BODY));
    }).not.toThrow();
  });

  it('rejects the same JSON re-serialised', () => {
    // THE v1 BUG, pinned. v1 verified against `JSON.stringify(req.body)`, which
    // passed locally because the test client used the same serialiser and failed
    // against real Razorpay traffic. This test fails the moment anyone swaps
    // rawBody for a re-serialisation.
    const reserialised = JSON.stringify(JSON.parse(BODY));

    // Same object, different bytes — the whole point.
    expect(JSON.parse(reserialised)).toEqual(JSON.parse(BODY));
    expect(reserialised).not.toBe(BODY);

    expect(() => {
      verify(reserialised, sign(BODY));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a body whose numbers were reformatted by a round trip', () => {
    // `9702.0` and `1e3` parse to the same numbers and stringify differently.
    // A verifier that re-serialises cannot tell these apart from the original.
    const exponential = '{"amount": 9.702e3}';

    expect(JSON.stringify(JSON.parse(exponential))).not.toBe(exponential);
    expect(() => {
      verify(JSON.stringify(JSON.parse(exponential)), sign(exponential));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects one altered byte in the body', () => {
    expect(() => {
      verify(BODY.replace('9702', '9701'), sign(BODY));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects one altered character in the signature', () => {
    const signature = sign(BODY);
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;

    expect(() => {
      verify(BODY, tampered);
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects an absent signature header', () => {
    expect(() => {
      verify(BODY, undefined);
    }).toThrow(InvalidWebhookSignatureError);
    expect(() => {
      verify(BODY, '');
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects an array-valued header rather than stringifying it', () => {
    // Fastify hands back `string[]` for a repeated header. Coercing it would
    // hash "sig,sig" and reject for the wrong reason; worse, a single-element
    // array would coerce to a *valid* signature.
    expect(() => {
      verify(BODY, [sign(BODY)]);
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a non-hex signature without timingSafeEqual throwing', () => {
    // Buffer.from(hex) truncates silently on bad input instead of throwing, and
    // timingSafeEqual throws on a length mismatch. Both are why the length is
    // compared first — otherwise this is a 500, not a 401.
    for (const bad of ['not-hex-at-all', 'zz'.repeat(32), '0', 'deadbeef']) {
      expect(() => {
        verify(BODY, bad);
      }).toThrow(InvalidWebhookSignatureError);
    }
  });

  it('rejects a signature made with a different secret', () => {
    expect(() => {
      verify(BODY, sign(BODY, 'some-other-secret'));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects an absent body', () => {
    expect(() => {
      service.verifyWebhookSignature(undefined, sign(BODY));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('verifies an empty body against its own signature', () => {
    // Not a case Razorpay sends, but the one where a "falsy body means skip the
    // check" shortcut would hide itself.
    expect(() => {
      verify('', sign(''));
    }).not.toThrow();
    expect(() => {
      verify('', sign('x'));
    }).toThrow(InvalidWebhookSignatureError);
  });

  it('signs unicode by its utf-8 bytes, not its code points', () => {
    const unicode = '{"note":"Basement Parking, 5th Cross — ₹97.02"}';

    expect(() => {
      verify(unicode, sign(unicode));
    }).not.toThrow();
    // The same text with the rupee sign escaped is different bytes, so a
    // signature over one must not verify the other.
    expect(() => {
      verify(unicode.replace('₹', '\\u20b9'), sign(unicode));
    }).toThrow(InvalidWebhookSignatureError);
  });
});

describe('verifyCheckoutSignature', () => {
  const service = new VerificationService();
  const checkoutSign = (orderId: string, paymentId: string): string =>
    createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

  it('accepts the HMAC of order_id|payment_id under the key secret', () => {
    expect(() => {
      service.verifyCheckoutSignature(
        'order_QK7xVv9pLm2Zab',
        'pay_abc123',
        checkoutSign('order_QK7xVv9pLm2Zab', 'pay_abc123'),
      );
    }).not.toThrow();
  });

  it('rejects a signature for a different payment on the same order', () => {
    expect(() =>
      service.verifyCheckoutSignature(
        'order_QK7xVv9pLm2Zab',
        'pay_abc123',
        checkoutSign('order_QK7xVv9pLm2Zab', 'pay_someone_else'),
      ),
    ).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects the webhook secret used in place of the key secret', () => {
    const wrong = createHmac('sha256', WEBHOOK_SECRET)
      .update('order_QK7xVv9pLm2Zab|pay_abc123')
      .digest('hex');

    expect(() =>
      service.verifyCheckoutSignature('order_QK7xVv9pLm2Zab', 'pay_abc123', wrong),
    ).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a non-hex signature without throwing from timingSafeEqual', () => {
    expect(() =>
      service.verifyCheckoutSignature('order_QK7xVv9pLm2Zab', 'pay_abc123', 'nonsense'),
    ).toThrow(InvalidWebhookSignatureError);
  });

  it('documents that the format is only unambiguous because ids cannot contain a pipe', () => {
    // An HMAC over `a|b` is ambiguous under delimiter shifting: ("x", "y|z")
    // and ("x|y", "z") hash the same message. Razorpay's format is Razorpay's
    // to define and its ids are [A-Za-z0-9_], so this is not exploitable — but
    // it is an assumption, and an assumption nobody wrote down is one a future
    // change quietly breaks.
    const shifted = checkoutSign('order_x', 'y|pay_z');

    expect(() => service.verifyCheckoutSignature('order_x|y', 'pay_z', shifted)).not.toThrow();

    // The ids Razorpay actually issues carry no pipe, so no real pair collides.
    expect('order_QK7xVv9pLm2Zab').toMatch(/^[A-Za-z0-9_]+$/);
    expect('pay_abc123').toMatch(/^[A-Za-z0-9_]+$/);
  });
});
