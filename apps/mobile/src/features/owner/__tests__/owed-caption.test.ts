import { describe, expect, it } from 'vitest';

import { owedCaption } from '../owed-caption';

describe('owedCaption — what "Owed to you" means once Route pays per booking (ADR-030)', () => {
  it('explains a zero balance as paid, not as nothing earned', () => {
    expect(owedCaption(0)).toBe('Each booking pays you as the driver pays.');
  });

  it('explains a positive balance as bookings not paid yet', () => {
    expect(owedCaption(5100)).toBe('From bookings the driver has not paid yet.');
  });

  it('says what a negative balance is, instead of copy written for money owed to them (S-92)', () => {
    expect(owedCaption(-5100)).toBe(
      'A driver was refunded after you were paid. ParkEase support will be in touch.',
    );
  });
});
