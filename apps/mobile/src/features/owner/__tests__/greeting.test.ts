import { describe, expect, it } from 'vitest';

import { greeting, growthCaption } from '../greeting';

describe('greeting', () => {
  it('reads the hour in IST, not the device zone', () => {
    expect(greeting(new Date('2026-09-12T01:00:00.000Z'))).toBe('Good morning'); // 06:30 IST
    expect(greeting(new Date('2026-09-12T08:00:00.000Z'))).toBe('Good afternoon'); // 13:30 IST
    expect(greeting(new Date('2026-09-12T13:00:00.000Z'))).toBe('Good evening'); // 18:30 IST
  });
});

describe('growthCaption', () => {
  it('says growth in words, so colour is never the only signal', () => {
    expect(growthCaption(1100)).toBe('11% more than last month');
    expect(growthCaption(-450)).toBe('4.5% less than last month');
    expect(growthCaption(0)).toBe('Same as last month');
    expect(growthCaption(null)).toBeNull();
  });
});
