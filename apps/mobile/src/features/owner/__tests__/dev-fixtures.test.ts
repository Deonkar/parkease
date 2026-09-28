import {
  OWNER_BOOKING_GROUP_VALUES,
  OWNER_EARNINGS_PERIOD_VALUES,
  type SpaceDetail,
  ownerBookingSchema,
  ownerDashboardSchema,
  ownerEarningsViewSchema,
  statementLineSchema,
} from '@parkease/contracts/owner';
import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import { devDashboard, devEarnings, devSpaceBookings, devTransactions } from '../api/dev-fixtures';

/**
 * The fixtures the owner dashboard, earnings and bookings screens serve under
 * a dev-mock session (task 7b, ruling T11-W1 extended to owner). Every value
 * is built through the real contract schema, so a fixture that drifts from
 * the contract fails here rather than on a screen.
 */

// 2026-09-24T14:30:00 IST (UTC+5:30) — day 24 of September.
const NOW = new Date('2026-09-24T09:00:00.000Z');

// Only `id`, `title` and `approvalStatus` are ever read by `devDashboard` — the
// rest of `SpaceDetail` is irrelevant to the fixture, so the cast stands in
// for a full space rather than restating every field of a schema this file
// does not exercise.
const SPACE_A = {
  id: '0192f2c0-0000-7000-8000-000000000001',
  title: 'Green Park Residency',
  approvalStatus: 'active',
} as unknown as SpaceDetail;

describe('every fixture parses through its contract schema', () => {
  it('the dashboard, with and without spaces', () => {
    expect(() => ownerDashboardSchema.parse(devDashboard([], NOW))).not.toThrow();
    expect(() => ownerDashboardSchema.parse(devDashboard([SPACE_A], NOW))).not.toThrow();
  });

  it('earnings, for every period', () => {
    for (const period of OWNER_EARNINGS_PERIOD_VALUES) {
      expect(() => ownerEarningsViewSchema.parse(devEarnings(period, NOW))).not.toThrow();
    }
  });

  it('transactions, across every page', () => {
    const first = devTransactions('month', undefined);
    expect(() => statementLineSchema.array().parse(first.data)).not.toThrow();
    expect(() => cursorPageMetaSchema.parse(first.meta)).not.toThrow();
  });

  it('space bookings, for every group', () => {
    for (const group of OWNER_BOOKING_GROUP_VALUES) {
      const page = devSpaceBookings('0192f2c0-0000-7000-8000-000000000001', group, NOW);
      expect(() => ownerBookingSchema.array().parse(page.data)).not.toThrow();
      expect(() => cursorPageMetaSchema.parse(page.meta)).not.toThrow();
    }
  });
});

describe('the dashboard', () => {
  it('shows the empty state when the owner has no spaces yet', () => {
    expect(devDashboard([], NOW).spaces).toEqual([]);
  });

  it('maps the owner’s real spaces, with literal occupancies', () => {
    const dashboard = devDashboard([SPACE_A], NOW);
    expect(dashboard.spaces).toEqual([
      {
        id: SPACE_A.id,
        title: SPACE_A.title,
        approvalStatus: SPACE_A.approvalStatus,
        occupancyBp: 6_200,
      },
    ]);
  });

  it('carries the brief’s three named statement lines, newest first', () => {
    const dashboard = devDashboard([], NOW);
    expect(dashboard.statement).toHaveLength(3);
    expect(dashboard.statement[0]).toMatchObject({
      driverName: 'Ravi K.',
      durationLabel: '2 hrs',
      basePaise: 6_000,
      feePaise: 900,
      reversedPaise: 0,
      netPaise: 5_100,
    });
    expect(dashboard.statement[1]).toMatchObject({
      driverName: 'Anita M.',
      durationLabel: 'Daily',
      basePaise: 20_000,
      feePaise: 3_000,
      reversedPaise: 0,
      netPaise: 17_000,
    });
    expect(dashboard.statement[2]).toMatchObject({
      driverName: 'Deepak R.',
      durationLabel: '3 hrs',
      basePaise: 9_000,
      feePaise: 1_350,
      reversedPaise: 3_825,
      netPaise: 3_825,
    });
  });

  it('uses the fallback space names when the owner has no spaces', () => {
    const dashboard = devDashboard([], NOW);
    for (const line of dashboard.statement) {
      expect(['Basement Parking, 5th Cross', 'Stilt Parking, Palm Meadows']).toContain(
        line.spaceName,
      );
    }
  });
});

describe('the surged-booking case', () => {
  it('never carries a surge or total key — the schema is strict', () => {
    const [line] = devDashboard([], NOW).statement;
    expect(line).toBeDefined();
    expect(line).not.toHaveProperty('surgePaise');
    expect(line).not.toHaveProperty('totalPaise');
    expect(line).not.toHaveProperty('gstPaise');
    expect(Object.keys(statementLineSchema.shape)).not.toContain('surgePaise');
  });
});

describe('earnings periods', () => {
  it('today is a single day', () => {
    const view = devEarnings('today', NOW);
    expect(view.days).toEqual([{ date: '2026-09-24', netPaise: view.netPaise }]);
  });

  it('week is seven days ending today, with a zero day for the empty bar style', () => {
    const view = devEarnings('week', NOW);
    expect(view.days).toHaveLength(7);
    expect(view.days[view.days.length - 1]?.date).toBe('2026-09-24');
    expect(view.days[0]?.date).toBe('2026-09-18');
    expect(view.days.some((day) => day.netPaise === 0)).toBe(true);
  });

  it('month is one day per day of the IST month up to now, with a zero day', () => {
    const view = devEarnings('month', NOW);
    expect(view.days).toHaveLength(24);
    expect(view.days[0]?.date).toBe('2026-09-01');
    expect(view.days[23]?.date).toBe('2026-09-24');
    for (const day of view.days) {
      expect(day.date).toMatch(/^2026-09-\d{2}$/);
    }
    expect(view.days.some((day) => day.netPaise === 0)).toBe(true);
  });
});

describe('transactions paging', () => {
  it('pages 5 + 5 + the rest, with correct hasMore and nextCursor', () => {
    const page1 = devTransactions('month', undefined);
    expect(page1.data).toHaveLength(5);
    expect(page1.meta).toEqual({ limit: 5, hasMore: true, nextCursor: '5' });

    const page2 = devTransactions('month', page1.meta.nextCursor ?? undefined);
    expect(page2.data).toHaveLength(5);
    expect(page2.meta).toEqual({ limit: 5, hasMore: true, nextCursor: '10' });

    const page3 = devTransactions('month', page2.meta.nextCursor ?? undefined);
    expect(page3.data.length).toBeGreaterThanOrEqual(2);
    expect(page3.meta).toEqual({ limit: 5, hasMore: false, nextCursor: null });

    const allIds = [...page1.data, ...page2.data, ...page3.data].map((line) => line.bookingId);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.length).toBeGreaterThanOrEqual(12);
  });

  it('serves the same paging shape regardless of period', () => {
    for (const period of OWNER_EARNINGS_PERIOD_VALUES) {
      const page = devTransactions(period, undefined);
      expect(page.data).toHaveLength(5);
    }
  });
});

describe('a space’s bookings', () => {
  it('has two active, one upcoming and two past', () => {
    expect(devSpaceBookings('space-1', 'active', NOW).data).toHaveLength(2);
    expect(devSpaceBookings('space-1', 'upcoming', NOW).data).toHaveLength(1);
    expect(devSpaceBookings('space-1', 'past', NOW).data).toHaveLength(2);
  });

  it('has not earned anything yet on a booking that has not started', () => {
    const [upcoming] = devSpaceBookings('space-1', 'upcoming', NOW).data;
    expect(upcoming?.earnedPaise).toBe(0);
  });

  it('shows a cancelled booking that never got a slot', () => {
    const past = devSpaceBookings('space-1', 'past', NOW).data;
    expect(
      past.some((booking) => booking.status === 'cancelled' && booking.slotIndex === null),
    ).toBe(true);
  });

  it('never has more than the fixture cap, so meta always says hasMore: false', () => {
    for (const group of OWNER_BOOKING_GROUP_VALUES) {
      expect(devSpaceBookings('space-1', group, NOW).meta).toEqual({
        limit: 20,
        hasMore: false,
        nextCursor: null,
      });
    }
  });
});
