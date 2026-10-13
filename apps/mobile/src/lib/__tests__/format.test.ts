import { describe, it, expect } from 'vitest';

import { formatDayMonthIST, formatDistance, formatDateIST, formatTimeIST } from '../format';

describe('formatDistance', () => {
  it('formats meters under 1km', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('formats km with one decimal under 10km', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(3200)).toBe('3.2 km');
    expect(formatDistance(9999)).toBe('10.0 km');
  });

  it('formats km as whole numbers at 10km+', () => {
    expect(formatDistance(10000)).toBe('10 km');
    expect(formatDistance(25600)).toBe('26 km');
  });
});

describe('formatDateIST', () => {
  it('formats a UTC date to IST', () => {
    const date = new Date('2026-01-15T06:30:00Z');
    const result = formatDateIST(date);
    expect(result).toBe('15 Jan 2026');
  });

  it('prints September as "Sep" from the fixed table, never ICU\'s "Sept" (S-41)', () => {
    expect(formatDateIST(new Date('2026-09-12T04:49:00.000Z'))).toBe('12 Sep 2026');
  });

  it('adds the weekday for list rows', () => {
    expect(formatDateIST(new Date('2026-09-12T04:49:00.000Z'), { weekday: true })).toBe(
      'Sat 12 Sep 2026',
    );
  });

  it('takes the year in IST: 31 Dec 20:00 UTC is already the new year', () => {
    expect(formatDateIST(new Date('2026-12-31T20:00:00.000Z'))).toBe('1 Jan 2027');
  });

  it.each([
    ['2026-01-10', 'Jan'],
    ['2026-02-10', 'Feb'],
    ['2026-03-10', 'Mar'],
    ['2026-04-10', 'Apr'],
    ['2026-05-10', 'May'],
    ['2026-06-10', 'Jun'],
    ['2026-07-10', 'Jul'],
    ['2026-08-10', 'Aug'],
    ['2026-09-10', 'Sep'],
    ['2026-10-10', 'Oct'],
    ['2026-11-10', 'Nov'],
    ['2026-12-10', 'Dec'],
  ])('%s prints %s', (day, month) => {
    expect(formatDateIST(new Date(`${day}T06:00:00.000Z`))).toBe(`10 ${month} 2026`);
  });
});

describe('formatTimeIST', () => {
  it('formats time in 12-hour IST', () => {
    const date = new Date('2026-01-15T06:30:00Z');
    const result = formatTimeIST(date);
    expect(result).toBe('12:00 PM');
  });

  it('handles midnight UTC → 5:30 AM IST', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    const result = formatTimeIST(date);
    expect(result).toBe('5:30 AM');
  });
});

describe('formatDayMonthIST', () => {
  it('formats day and month with no year', () => {
    expect(formatDayMonthIST(new Date('2026-09-12T04:49:00.000Z'))).toBe('12 Sep');
  });

  it('adds the weekday abbreviation when asked', () => {
    expect(formatDayMonthIST(new Date('2026-09-12T04:49:00.000Z'), { weekday: true })).toBe(
      'Sat 12 Sep',
    );
  });

  it('crosses the IST midnight boundary: 18:45 UTC is already the next day in IST', () => {
    // 2026-09-11T18:45Z + 5:30 = 2026-09-12T00:15 IST.
    expect(formatDayMonthIST(new Date('2026-09-11T18:45:00.000Z'), { weekday: true })).toBe(
      'Sat 12 Sep',
    );
  });

  it('always prints the fixed 3-letter month table, never a 4-letter ICU spelling', () => {
    // September, per the S-41 note, is where `toLocaleString` disagrees with
    // itself across ICU builds ("Sep" vs "Sept").
    expect(formatDayMonthIST(new Date('2026-09-01T04:00:00.000Z'))).toMatch(/^1 Sep$/);
  });
});
