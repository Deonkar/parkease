import { describe, expect, it } from 'vitest';

import {
  ownerBookingsQuerySchema,
  ownerDashboardSchema,
  ownerEarningsQuerySchema,
  ownerEarningsViewSchema,
  ownerTransactionsQuerySchema,
  statementLineSchema,
} from '../src/owner/index.js';

const line = {
  bookingId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  occurredAt: '2026-09-12T04:49:00.000Z',
  driverName: 'Ravi K.',
  spaceName: 'Basement Parking, 5th Cross',
  durationLabel: '2 hrs',
  basePaise: 6000,
  feePaise: 900,
  reversedPaise: 0,
  netPaise: 5100,
};

describe('owner earnings query', () => {
  it('defaults to the month', () => {
    expect(ownerEarningsQuerySchema.parse({})).toEqual({ period: 'month' });
  });

  it('refuses a period the owner surface does not offer', () => {
    expect(ownerEarningsQuerySchema.safeParse({ period: 'all' }).success).toBe(false);
  });

  it('pages transactions with the shared limit default', () => {
    expect(ownerTransactionsQuerySchema.parse({})).toEqual({ period: 'month', limit: 20 });
  });
});

describe('statementLineSchema', () => {
  it('accepts base, fee, reversal and net', () => {
    expect(statementLineSchema.parse(line)).toEqual(line);
  });

  // ADR-009: surge is platform revenue. A line that carries it would put it on
  // the owner's screen, which is the v1 support ticket.
  it('refuses a surge or total field', () => {
    expect(statementLineSchema.safeParse({ ...line, surgePaise: 3000 }).success).toBe(false);
    expect(statementLineSchema.safeParse({ ...line, totalPaise: 9702 }).success).toBe(false);
  });
});

describe('ownerEarningsViewSchema', () => {
  it('allows a negative period net — movement, not a balance', () => {
    const view = {
      period: 'week',
      netPaise: -2550,
      grossPaise: 0,
      reversedPaise: 2550,
      bookings: 0,
      days: [{ date: '2026-09-08', netPaise: -2550 }],
    };
    expect(ownerEarningsViewSchema.parse(view)).toEqual(view);
  });

  it('refuses a malformed day', () => {
    expect(
      ownerEarningsViewSchema.safeParse({
        period: 'week',
        netPaise: 0,
        grossPaise: 0,
        reversedPaise: 0,
        bookings: 0,
        days: [{ date: '8 Sep', netPaise: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('ownerDashboardSchema', () => {
  it('accepts a dashboard with no growth figure yet', () => {
    const dashboard = {
      greetingName: 'Priya',
      owedPaise: 348000,
      today: { netPaise: 48000, bookings: 3 },
      month: { netPaise: 1280000, growthBp: null },
      activeBookings: 3,
      statement: [line],
      spaces: [
        {
          id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
          title: 'Basement Parking',
          approvalStatus: 'active',
          occupancyBp: 6200,
        },
      ],
    };
    expect(ownerDashboardSchema.parse(dashboard)).toEqual(dashboard);
  });
});

describe('ownerBookingsQuerySchema', () => {
  it('defaults to the active group', () => {
    expect(ownerBookingsQuerySchema.parse({})).toEqual({ group: 'active', limit: 20 });
  });
});
