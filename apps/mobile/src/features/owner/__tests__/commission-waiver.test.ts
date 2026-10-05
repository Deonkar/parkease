import { describe, expect, it } from 'vitest';

import { earningsSubtitle, waiverRow } from '../commission-waiver';

describe('commission-free copy (task 16c)', () => {
  it('names the IST end date on the dashboard row', () => {
    expect(waiverRow({ endsOn: '2027-01-05' })).toBe(
      'Commission-free until 5 Jan · you keep the full price of every booking.',
    );
  });

  it('shows no row outside the window', () => {
    expect(waiverRow(null)).toBeNull();
  });

  it('switches the earnings subtitle while commission-free', () => {
    expect(earningsSubtitle({ endsOn: '2027-01-05' })).toBe('You keep the full price until 5 Jan');
    expect(earningsSubtitle(null)).toBe('Your share, after the ParkEase fee');
  });
});
