import {
  type OwnerBooking,
  type OwnerBookingGroup,
  type OwnerDashboard,
  type OwnerEarningsPeriod,
  type OwnerEarningsView,
  type SpaceDetail,
  type StatementLine,
  ownerBookingSchema,
  ownerDashboardSchema,
  ownerEarningsViewSchema,
  statementLineSchema,
} from '@parkease/contracts/owner';
import { type CursorPageMeta, cursorPageMetaSchema } from '@parkease/contracts/primitives';

import { toIST } from '@/lib/format';

/**
 * What the owner dashboard, earnings and bookings screens serve under a
 * dev-mock session, so every screen can be opened and walked in the browser
 * preview with no API and no database (task 7b) — the only local API database
 * is `parkease_dev`, which the agent must never touch (R-ENV-06). Engaged only
 * through `isOwnerDevMock()`, which requires `__DEV__` — never reachable in a
 * release build.
 *
 * Copied from the washer's `dev-fixtures.ts`, not imported (cross-role imports
 * are a lint failure), with the same rule: EVERY value is built through the
 * real contract schema, on every read, so a fixture cannot drift from the
 * contract without a test failing (`dev-fixtures.test.ts`).
 *
 * Money is fixed integer paise literals throughout, and nothing here does
 * arithmetic on any of it — no rate, no `0.15` (R-FE-06). Fee amounts happen
 * to read as 15% of base (ADR-009's shape), but every field is written as its
 * own literal, never derived from another one in this file.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for an IST calendar date already split into parts. */
function istDateString(year: number, month: number, day: number): string {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

/** The IST calendar date `now` falls on, as `YYYY-MM-DD`. */
function todayIST(now: Date): string {
  const ist = toIST(now);
  return istDateString(ist.getFullYear(), ist.getMonth() + 1, ist.getDate());
}

// ---------------------------------------------------------------------------
// The owner's statement: newest first, shared by the dashboard's three-line
// preview and the earnings screen's paged transaction list.
// ---------------------------------------------------------------------------

interface StatementSeed {
  readonly bookingId: string;
  readonly driverName: string;
  readonly durationLabel: string;
  readonly basePaise: number;
  readonly feePaise: number;
  readonly reversedPaise: number;
  readonly netPaise: number;
  /** Hours before `now` this booking was posted to the ledger. Newest first. */
  readonly hoursAgo: number;
}

/**
 * Fourteen bookings — enough for three pages at the earnings screen's page
 * size of 5. The first three are the brief's named cases: (a) Ravi K., the
 * surged-booking case where surge never rides along on the line at all
 * (`statementLineSchema` is strict — no surge, no total, no GST); (b) Anita
 * M., a plain daily booking; (c) Deepak R., a booking half refunded after the
 * fact, where `reversedPaise` is exactly what `netPaise` gave up.
 */
const STATEMENT_SEEDS: readonly StatementSeed[] = [
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0001',
    driverName: 'Ravi K.',
    durationLabel: '2 hrs',
    basePaise: 6_000,
    feePaise: 900,
    reversedPaise: 0,
    netPaise: 5_100,
    hoursAgo: 3,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0002',
    driverName: 'Anita M.',
    durationLabel: 'Daily',
    basePaise: 20_000,
    feePaise: 3_000,
    reversedPaise: 0,
    netPaise: 17_000,
    hoursAgo: 20,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0003',
    driverName: 'Deepak R.',
    durationLabel: '3 hrs',
    basePaise: 9_000,
    feePaise: 1_350,
    reversedPaise: 3_825,
    netPaise: 3_825,
    hoursAgo: 30,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0004',
    driverName: 'Priya S.',
    durationLabel: '4 hrs',
    basePaise: 12_000,
    feePaise: 1_800,
    reversedPaise: 0,
    netPaise: 10_200,
    hoursAgo: 50,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0005',
    driverName: 'Suresh K.',
    durationLabel: '1 hr',
    basePaise: 3_000,
    feePaise: 450,
    reversedPaise: 0,
    netPaise: 2_550,
    hoursAgo: 70,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0006',
    driverName: 'Kavya N.',
    durationLabel: 'Daily',
    basePaise: 18_000,
    feePaise: 2_700,
    reversedPaise: 0,
    netPaise: 15_300,
    hoursAgo: 95,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0007',
    driverName: 'Manoj T.',
    durationLabel: '6 hrs',
    basePaise: 15_000,
    feePaise: 2_250,
    reversedPaise: 0,
    netPaise: 12_750,
    hoursAgo: 120,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0008',
    driverName: 'Divya R.',
    durationLabel: '2 hrs',
    basePaise: 6_000,
    feePaise: 900,
    reversedPaise: 0,
    netPaise: 5_100,
    hoursAgo: 150,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c0009',
    driverName: 'Arjun V.',
    durationLabel: '5 hrs',
    basePaise: 10_000,
    feePaise: 1_500,
    reversedPaise: 0,
    netPaise: 8_500,
    hoursAgo: 180,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c000a',
    driverName: 'Lakshmi P.',
    durationLabel: 'Daily',
    basePaise: 22_000,
    feePaise: 3_300,
    reversedPaise: 0,
    netPaise: 18_700,
    hoursAgo: 210,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c000b',
    driverName: 'Harish B.',
    durationLabel: '3 hrs',
    basePaise: 9_000,
    feePaise: 1_350,
    reversedPaise: 0,
    netPaise: 7_650,
    hoursAgo: 240,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c000c',
    driverName: 'Nandini S.',
    durationLabel: '1 hr',
    basePaise: 3_000,
    feePaise: 450,
    reversedPaise: 0,
    netPaise: 2_550,
    hoursAgo: 280,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c000d',
    driverName: 'Vikram J.',
    durationLabel: '4 hrs',
    basePaise: 12_000,
    feePaise: 1_800,
    reversedPaise: 1_800,
    netPaise: 8_400,
    hoursAgo: 320,
  },
  {
    bookingId: '0192f2b1-0000-7000-8000-0000000c000e',
    driverName: 'Meera K.',
    durationLabel: '2 hrs',
    basePaise: 6_000,
    feePaise: 900,
    reversedPaise: 0,
    netPaise: 5_100,
    hoursAgo: 360,
  },
];

const FALLBACK_SPACE_NAMES = [
  'Basement Parking, 5th Cross',
  'Stilt Parking, Palm Meadows',
] as const;

/** The owner's real space titles when given (the dashboard's own spaces), else the fallback pair. */
function spaceNameAt(index: number, spaces: readonly SpaceDetail[] | undefined): string {
  const fallback = index % 2 === 0 ? FALLBACK_SPACE_NAMES[0] : FALLBACK_SPACE_NAMES[1];
  if (spaces === undefined || spaces.length === 0) return fallback;
  return spaces[index % spaces.length]?.title ?? fallback;
}

/** Re-parsed on every call, so a schema drift fails the test instead of the screen. */
function buildStatementLines(nowMs: number, spaces?: readonly SpaceDetail[]): StatementLine[] {
  return STATEMENT_SEEDS.map((seed, index) =>
    statementLineSchema.parse({
      bookingId: seed.bookingId,
      occurredAt: new Date(nowMs - seed.hoursAgo * HOUR_MS).toISOString(),
      driverName: seed.driverName,
      spaceName: spaceNameAt(index, spaces),
      durationLabel: seed.durationLabel,
      basePaise: seed.basePaise,
      feePaise: seed.feePaise,
      reversedPaise: seed.reversedPaise,
      netPaise: seed.netPaise,
    }),
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function devDashboard(
  spaces: readonly SpaceDetail[],
  now: Date = new Date(),
): OwnerDashboard {
  const statement = buildStatementLines(now.getTime(), spaces).slice(0, 3);
  return ownerDashboardSchema.parse({
    greetingName: 'Priya',
    owedPaise: 348_000,
    today: { netPaise: 48_000, bookings: 3 },
    month: { netPaise: 1_280_000, growthBp: 1_100 },
    activeBookings: 3,
    statement,
    // Empty when the owner has no spaces yet, so the "List your first space"
    // empty state is reachable straight from the dev-mock session.
    spaces: spaces.map((space, index) => ({
      id: space.id,
      title: space.title,
      approvalStatus: space.approvalStatus,
      occupancyBp: index % 2 === 0 ? 6_200 : 3_300,
    })),
  });
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

const EARNINGS_HEADLINE: Record<
  OwnerEarningsPeriod,
  { netPaise: number; grossPaise: number; reversedPaise: number; bookings: number }
> = {
  today: { netPaise: 48_000, grossPaise: 56_000, reversedPaise: 8_000, bookings: 3 },
  week: { netPaise: 214_200, grossPaise: 238_000, reversedPaise: 23_800, bookings: 14 },
  month: { netPaise: 892_500, grossPaise: 990_000, reversedPaise: 97_500, bookings: 58 },
};

/** Chronological, oldest to newest, ending today. One zero day: the empty bar style. */
const WEEK_DAY_PAISE: readonly number[] = [30_600, 45_900, 0, 61_200, 38_250, 25_500, 12_750];

/**
 * Indexed by day-of-month (day 1 at position 0), never computed. Long enough
 * to cover every day a real month can have, with zero days scattered through
 * it so any "up to now" slice still shows the empty bar style.
 */
const MONTH_DAY_PAISE: readonly number[] = [
  12_750, 0, 25_500, 38_250, 0, 45_900, 30_600, 15_300, 0, 51_000, 22_950, 38_250, 0, 45_900,
  30_600, 15_300, 25_500, 0, 38_250, 45_900, 12_750, 30_600, 0, 51_000, 25_500, 38_250, 15_300, 0,
  45_900, 30_600, 12_750,
];

function weekDays(now: Date): { date: string; netPaise: number }[] {
  const ist = toIST(now);
  const last = WEEK_DAY_PAISE.length - 1;
  return WEEK_DAY_PAISE.map((netPaise, index) => {
    const shifted = new Date(ist.getTime() - (last - index) * DAY_MS);
    return {
      date: istDateString(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate()),
      netPaise,
    };
  });
}

function monthDays(now: Date): { date: string; netPaise: number }[] {
  const ist = toIST(now);
  const year = ist.getFullYear();
  const month = ist.getMonth() + 1;
  const dayOfMonth = ist.getDate();
  return Array.from({ length: dayOfMonth }, (_unused, index) => ({
    date: istDateString(year, month, index + 1),
    netPaise: MONTH_DAY_PAISE[index % MONTH_DAY_PAISE.length] ?? 0,
  }));
}

export function devEarnings(
  period: OwnerEarningsPeriod,
  now: Date = new Date(),
): OwnerEarningsView {
  const headline = EARNINGS_HEADLINE[period];
  const days =
    period === 'today'
      ? [{ date: todayIST(now), netPaise: headline.netPaise }]
      : period === 'week'
        ? weekDays(now)
        : monthDays(now);
  return ownerEarningsViewSchema.parse({ period, ...headline, days });
}

// ---------------------------------------------------------------------------
// Transactions (the earnings screen's paged statement)
// ---------------------------------------------------------------------------

const TRANSACTIONS_PAGE_SIZE = 5;

/**
 * `period` mirrors the real endpoint's query param but the preview fixture
 * pages the same fourteen-line statement for every period — there is no
 * separate dataset per period to model, only the paging contract to exercise.
 * The cursor is the string index of the next page (`'5'`, `'10'`).
 */
export function devTransactions(
  period: OwnerEarningsPeriod,
  cursor: string | undefined,
): { data: StatementLine[]; meta: CursorPageMeta } {
  void period;
  const lines = buildStatementLines(Date.now());
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const data = lines.slice(start, start + TRANSACTIONS_PAGE_SIZE);
  const nextIndex = start + TRANSACTIONS_PAGE_SIZE;
  const hasMore = nextIndex < lines.length;
  return {
    data,
    meta: cursorPageMetaSchema.parse({
      limit: TRANSACTIONS_PAGE_SIZE,
      hasMore,
      nextCursor: hasMore ? String(nextIndex) : null,
    }),
  };
}

// ---------------------------------------------------------------------------
// A space's bookings
// ---------------------------------------------------------------------------

interface BookingSeed {
  readonly bookingId: string;
  readonly driverName: string;
  readonly vehicleType: OwnerBooking['vehicleType'];
  readonly slotIndex: number | null;
  readonly status: OwnerBooking['status'];
  readonly earnedPaise: number;
  /** Offsets from `now`, in hours. */
  readonly startsInHours: number;
  readonly endsInHours: number;
}

/** Two live now, one still ahead, two already closed — one of those cancelled with no slot ever assigned. */
const SPACE_BOOKING_SEEDS: Record<OwnerBookingGroup, readonly BookingSeed[]> = {
  active: [
    {
      bookingId: '0192f2b2-0000-7000-8000-0000000d0001',
      driverName: 'Rohit S.',
      vehicleType: 'car',
      slotIndex: 2,
      status: 'active',
      earnedPaise: 5_100,
      startsInHours: -1,
      endsInHours: 1,
    },
    {
      bookingId: '0192f2b2-0000-7000-8000-0000000d0002',
      driverName: 'Fatima N.',
      vehicleType: 'two_wheeler',
      slotIndex: 5,
      status: 'active',
      earnedPaise: 2_550,
      startsInHours: -0.5,
      endsInHours: 1.5,
    },
  ],
  upcoming: [
    {
      bookingId: '0192f2b2-0000-7000-8000-0000000d0003',
      driverName: 'Vikas P.',
      vehicleType: 'car',
      slotIndex: 1,
      status: 'confirmed',
      // Not yet earned: the ledger has not posted anything for a booking that
      // has not started.
      earnedPaise: 0,
      startsInHours: 3,
      endsInHours: 5,
    },
  ],
  past: [
    {
      bookingId: '0192f2b2-0000-7000-8000-0000000d0004',
      driverName: 'Meena L.',
      vehicleType: 'car',
      slotIndex: 3,
      status: 'completed',
      earnedPaise: 7_650,
      startsInHours: -30,
      endsInHours: -28,
    },
    {
      bookingId: '0192f2b2-0000-7000-8000-0000000d0005',
      driverName: 'Ganesh R.',
      vehicleType: 'two_wheeler',
      // Cancelled before check-in: no slot was ever assigned.
      slotIndex: null,
      status: 'cancelled',
      earnedPaise: 0,
      startsInHours: -50,
      endsInHours: -49,
    },
  ],
};

/** Well under the real endpoint's 20-row cap, so `meta.hasMore` is always false here. */
export function devSpaceBookings(
  spaceId: string,
  group: OwnerBookingGroup,
  now: Date = new Date(),
): { data: OwnerBooking[]; meta: CursorPageMeta } {
  void spaceId;
  const nowMs = now.getTime();
  const data = SPACE_BOOKING_SEEDS[group].map((seed) =>
    ownerBookingSchema.parse({
      bookingId: seed.bookingId,
      driverName: seed.driverName,
      vehicleType: seed.vehicleType,
      slotIndex: seed.slotIndex,
      startsAt: new Date(nowMs + seed.startsInHours * HOUR_MS).toISOString(),
      endsAt: new Date(nowMs + seed.endsInHours * HOUR_MS).toISOString(),
      status: seed.status,
      earnedPaise: seed.earnedPaise,
    }),
  );
  return {
    data,
    meta: cursorPageMetaSchema.parse({ limit: 20, hasMore: false, nextCursor: null }),
  };
}
