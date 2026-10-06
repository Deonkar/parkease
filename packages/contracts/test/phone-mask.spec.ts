import { describe, expect, it } from 'vitest';

import { maskPhone } from '../src/primitives/phone-mask.js';

describe('maskPhone', () => {
  it('keeps the first five and last two digits of a +91 mobile number', () => {
    expect(maskPhone('+919876543210')).toBe('+91 98765***10');
  });

  it('never leaks digits 6 to 8 of the number', () => {
    const masked = maskPhone('+919876543210');
    expect(masked).not.toContain('432');
    expect(masked).not.toContain('543');
  });

  it.each([
    ['a 9-digit number', '+91987654321'],
    ['an empty string', ''],
    ['a non-Indian number', '+14155550123'],
    ['an 11-digit number', '+9198765432101'],
    ['a number without the plus', '919876543210'],
  ])('returns *** for %s', (_label, input) => {
    expect(maskPhone(input)).toBe('***');
  });
});
