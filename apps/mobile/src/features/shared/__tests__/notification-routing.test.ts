import type { NotificationView } from '@parkease/contracts/shared';
import { describe, expect, it, vi } from 'vitest';

import { badgeText, groupByDay, relativeTime, resolveTap } from '../notifications/routing';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const item = (createdAt: string, id = createdAt): NotificationView =>
  ({
    id,
    category: 'bookings',
    actionable: false,
    title: 't',
    body: 'b',
    deepLink: null,
    isRead: false,
    createdAt,
  }) as NotificationView;

describe('resolveTap', () => {
  it('lands on a link into the role the user is acting as', () => {
    expect(resolveTap('/(driver)/bookings/abc', ['driver', 'owner'], 'driver')).toEqual({
      href: '/(driver)/bookings/abc',
      switchTo: null,
    });
  });

  it('switches first when the link is for another role the user holds', () => {
    expect(resolveTap('/(owner)/listings/s1', ['driver', 'owner'], 'driver')).toEqual({
      href: '/(owner)/listings/s1',
      switchTo: 'owner',
    });
  });

  it('refuses a link into a role the user does not hold', () => {
    expect(resolveTap('/(valet)/offers', ['driver'], 'driver')).toBeNull();
  });

  it('shared links need no role', () => {
    expect(resolveTap('/(shared)/settings', ['driver'], 'driver')?.switchTo).toBeNull();
  });

  it.each([
    42,
    undefined,
    '',
    'https://evil.example/x',
    '//evil.example',
    '/(driver)/../(owner)/x',
    '/(admin)/users',
    '/(driver)//x',
    'parkease://x',
  ])('treats %j as untrusted and opens the feed', (link) => {
    expect(resolveTap(link, ['driver', 'owner', 'admin'], 'driver')).toBeNull();
  });
});

describe('groupByDay', () => {
  // 2026-10-07 18:00 IST
  const now = new Date('2026-10-07T12:30:00Z');

  it('splits into Today, Yesterday and Earlier on IST midnight, keeping order', () => {
    const sections = groupByDay(
      [
        item('2026-10-07T12:00:00Z'),
        item('2026-10-06T19:00:00Z'), // 7 Oct 00:30 IST: still today
        item('2026-10-06T18:00:00Z'), // 6 Oct 23:30 IST: yesterday
        item('2026-10-04T10:00:00Z'),
      ],
      now,
    );
    expect(sections.map((s) => [s.label, s.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['Earlier', 1],
    ]);
  });

  it('is empty for no items', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-07T12:30:00Z');
  it.each([
    ['2026-10-07T12:29:50Z', 'Just now'],
    ['2026-10-07T12:15:00Z', '15 min ago'],
    ['2026-10-07T09:30:00Z', '3 h ago'],
  ])('%s is %s', (iso, text) => {
    expect(relativeTime(iso, now)).toBe(text);
  });
});

describe('badgeText', () => {
  it.each([
    [0, null],
    [-1, null],
    [7, '7'],
    [99, '99'],
    [100, '99+'],
  ])('%d -> %j', (n, text) => {
    expect(badgeText(n)).toBe(text);
  });
});
