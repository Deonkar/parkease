import { describe, expect, it } from 'vitest';

import { redactAuditValue } from '../src/platform/observability/audit-redaction.js';

describe('redactAuditValue', () => {
  it('masks a phone, drops secret-looking keys at any depth and keeps the rest', () => {
    const redacted = redactAuditValue({
      phone: '+919876543210',
      nested: { refreshToken: 'x', accountNumber: '123', ok: 1 },
    });
    expect(redacted).toEqual({ phone: '+91 98765***10', nested: { ok: 1 } });
  });

  it.each([
    'token',
    'accessToken',
    'client_secret',
    'password',
    'account_number',
    'accountNumber',
    'ifsc',
    'IFSC_CODE',
    'razorpaySignature',
    'otp',
  ])('drops the key %s', (key) => {
    expect(redactAuditValue({ [key]: 'v', keep: 'k' })).toEqual({ keep: 'k' });
  });

  it('walks arrays and masks a phone inside one', () => {
    expect(
      redactAuditValue({ contacts: ['+919876543210', { otp: '1', n: 2 }, ['+919876543210']] }),
    ).toEqual({ contacts: ['+91 98765***10', { n: 2 }, ['+91 98765***10']] });
  });

  it('masks a phone that is the whole value, and leaves non-phone strings and primitives alone', () => {
    expect(redactAuditValue('+919876543210')).toBe('+91 98765***10');
    expect(redactAuditValue('+91 98765 43210')).toBe('+91 98765 43210');
    expect(redactAuditValue('hello')).toBe('hello');
    expect(redactAuditValue(7)).toBe(7);
    expect(redactAuditValue(null)).toBeNull();
    expect(redactAuditValue(undefined)).toBeUndefined();
  });

  it('hides a foreign-format number behind *** rather than passing it through', () => {
    expect(redactAuditValue('+14155550123')).toBe('***');
  });

  it('does not mutate its input', () => {
    const input = { phone: '+919876543210', refreshToken: 'x' };
    redactAuditValue(input);
    expect(input).toEqual({ phone: '+919876543210', refreshToken: 'x' });
  });

  it('truncates a container nested deeper than depth eight', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) deep = { child: deep };

    let node = redactAuditValue(deep);
    let levels = 0;
    while (typeof node === 'object' && node !== null) {
      node = (node as { child: unknown }).child;
      levels += 1;
    }
    expect(node).toBe('[truncated]');
    expect(levels).toBe(9);
  });

  it('keeps containers down to depth eight intact', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 8; i++) deep = { child: deep };
    expect(redactAuditValue(deep)).toEqual(deep);
  });
});
