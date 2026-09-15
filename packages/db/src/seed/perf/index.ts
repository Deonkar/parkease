import type { Amenity } from '@parkease/contracts/enums';
import { AMENITY_VALUES } from '@parkease/contracts/enums';
import { GST_RATE, PLATFORM_COMMISSION_RATE } from '@parkease/contracts/money';
import type { SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';
import { addPaise, mulRate, subPaise, toPaise, type Paise } from '@parkease/contracts/primitives';
import { inArray, sql } from 'drizzle-orm';

import type { Database } from '../../client.js';
import { uuidv7 } from '../../id.js';
import { bookings, bookingSlots } from '../../schema/booking.js';
import { users } from '../../schema/identity.js';
import { spaces, spaceSlots } from '../../schema/space.js';

// Bangalore bounding box (task-07 §"search-performance.spec.ts").
const LAT_MIN = 12.83;
const LAT_MAX = 13.14;
const LNG_MIN = 77.46;
const LNG_MAX = 77.78;

const DEFAULT_COUNT = 10_000;
const DEFAULT_SEED = 42;

const OWNER_POOL_SIZE = 50;
const DRIVER_POOL_SIZE = 50;

const SPACE_BATCH = 500;
const SLOT_BATCH = 2_000;
const BOOKING_BATCH = 500;
const BOOKING_SLOT_BATCH = 2_000;

// ~4,000 booking_slots on the reference fixture (10,000 spaces, ~35,000
// space_slots). Scaled so a smaller `count` still gets proportionate coverage.
const BOOKING_SLOT_FRACTION = 4_000 / 35_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_BOOKING_MS = 30 * 60 * 1000;
const MAX_BOOKING_EXTRA_MS = 210 * 60 * 1000; // up to 4 hours total

export interface SeedPerfOptions {
  count?: number;
  seed?: number;
}

export interface SeedPerfResult {
  spaceIds: string[];
  bookingSlotCount: number;
}

/**
 * Seeded PRNG (mulberry32) so perf runs are comparable across invocations.
 * Not Math.random() — determinism is the point.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickFrom<T>(pool: readonly T[], index: number): T {
  const item = pool[index % pool.length];
  if (item === undefined) throw new Error('pickFrom: empty pool');
  return item;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Fisher-Yates, driven by the seeded PRNG so the sample is deterministic. */
function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue; // unreachable: i, j always in range
    items[i] = b;
    items[j] = a;
  }
}

interface VehiclePlan {
  car: boolean;
  twoWheeler: boolean;
  hourlyOnly: boolean;
}

function planVehicles(rng: () => number): VehiclePlan {
  const r = rng();
  return {
    car: r < 0.8, // car-only band [0, 0.3) + both band [0.3, 0.8)
    twoWheeler: r >= 0.3, // both band [0.3, 0.8) + two-wheeler-only band [0.8, 1)
    hourlyOnly: rng() < 0.3, // some spaces have no daily/weekly/monthly price
  };
}

function durationPricing(
  rng: () => number,
  hourlyOnly: boolean,
): { hourlyPaise: Paise; dailyPaise?: Paise; weeklyPaise?: Paise; monthlyPaise?: Paise } {
  const hourlyPaise = toPaise(1_000 + Math.floor(rng() * 5_000)); // Rs 10 - Rs 60
  if (hourlyOnly) return { hourlyPaise };
  const dailyPaise = toPaise(hourlyPaise * 8);
  const weeklyPaise = toPaise(dailyPaise * 5);
  const monthlyPaise = toPaise(weeklyPaise * 3);
  return { hourlyPaise, dailyPaise, weeklyPaise, monthlyPaise };
}

function pickAmenities(rng: () => number): Amenity[] {
  return AMENITY_VALUES.filter(() => rng() < 0.25);
}

function pickRating(rng: () => number): { ratingAvgBp: number | null; ratingCount: number } {
  if (rng() < 0.25) return { ratingAvgBp: null, ratingCount: 0 }; // never reviewed
  const stars = 2.5 + rng() * 2.5; // 2.5 - 5.0
  return { ratingAvgBp: Math.round(stars * 10_000), ratingCount: 1 + Math.floor(rng() * 200) };
}

function pincodeFor(i: number): string {
  return `560${String(100 + (i % 300)).padStart(3, '0')}`;
}

interface SlotRef {
  spaceId: string;
  vehicleType: 'car' | 'two_wheeler';
  slotIndex: number;
}

/**
 * Seeds a Bangalore-scattered performance fixture: `count` active spaces,
 * 1-6 space_slots each, and a proportionate share of booking_slots spanning
 * the next 24 hours. Batched multi-row inserts throughout — never one round
 * trip per row.
 */
export async function seedPerfSpaces(
  db: Database,
  options?: SeedPerfOptions,
): Promise<SeedPerfResult> {
  const count = options?.count ?? DEFAULT_COUNT;
  const seed = options?.seed ?? DEFAULT_SEED;
  const rng = mulberry32(seed);
  const now = new Date();

  // --- Owner / driver pool -------------------------------------------------
  const ownerRows = Array.from({ length: OWNER_POOL_SIZE }, (_, i) => ({
    id: uuidv7(),
    phone: `+91700000${String(i).padStart(4, '0')}`,
    name: `Perf Owner ${String(i)}`,
    firebaseUid: `perf:owner:${String(i)}`,
    status: 'active' as const,
  }));
  const driverRows = Array.from({ length: DRIVER_POOL_SIZE }, (_, i) => ({
    id: uuidv7(),
    phone: `+91800000${String(i).padStart(4, '0')}`,
    name: `Perf Driver ${String(i)}`,
    firebaseUid: `perf:driver:${String(i)}`,
    status: 'active' as const,
  }));

  await db.insert(users).values(ownerRows).onConflictDoNothing({ target: users.phone });
  await db.insert(users).values(driverRows).onConflictDoNothing({ target: users.phone });

  // onConflictDoNothing skips rows that already exist (re-running the seed),
  // so resolve the full pool by phone with one SELECT rather than trusting
  // insert order.
  const phoneToId = new Map<string, string>();
  const allPhones = [...ownerRows, ...driverRows].map((r) => r.phone);
  const pool = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(inArray(users.phone, allPhones));
  for (const row of pool) phoneToId.set(row.phone, row.id);

  const ownerIds = ownerRows.map((r) => {
    const id = phoneToId.get(r.phone);
    if (id === undefined) throw new Error(`seed-perf: owner ${r.phone} not resolved`);
    return id;
  });
  const driverIds = driverRows.map((r) => {
    const id = phoneToId.get(r.phone);
    if (id === undefined) throw new Error(`seed-perf: driver ${r.phone} not resolved`);
    return id;
  });

  // --- Spaces ----------------------------------------------------------------
  const spaceIds: string[] = [];
  const spaceRows: (typeof spaces.$inferInsert)[] = [];
  const plansBySpaceId = new Map<string, VehiclePlan>();

  for (let i = 0; i < count; i++) {
    const id = uuidv7();
    const lat = LAT_MIN + rng() * (LAT_MAX - LAT_MIN);
    const lng = LNG_MIN + rng() * (LNG_MAX - LNG_MIN);
    const plan = planVehicles(rng);

    const pricing: SpacePricing = {};
    if (plan.car) pricing.car = durationPricing(rng, plan.hourlyOnly);
    if (plan.twoWheeler) pricing.twoWheeler = durationPricing(rng, plan.hourlyOnly);

    const { ratingAvgBp, ratingCount } = pickRating(rng);

    spaceRows.push({
      id,
      ownerId: pickFrom(ownerIds, i),
      title: `Perf Space #${String(i)}`,
      addressLine: `Perf Fixture Block ${String(i % 500)}, Bangalore`,
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: pincodeFor(i),
      location: { lat, lng },
      // Real geohash is backfilled in one UPDATE after insert (matches
      // migration 0013's own pattern) instead of reimplementing ST_GeoHash in JS.
      zoneId: 'pending',
      pricing,
      schedule: { is24x7: true } satisfies SpaceSchedule,
      amenities: pickAmenities(rng),
      approvalStatus: 'active',
      submittedAt: now,
      approvedAt: now,
      ratingAvgBp,
      ratingCount,
    });
    plansBySpaceId.set(id, plan);
    spaceIds.push(id);
  }

  for (const batch of chunk(spaceRows, SPACE_BATCH)) {
    await db.insert(spaces).values(batch);
  }

  // Backfill zone_id with the real geohash in one statement, identical to how
  // migration 0013 derives it — no separate JS geohash implementation.
  // Scoped by the 'pending' placeholder rather than an id array: an array of
  // 10,000 uuids would either blow the parameter limit or (interpolated
  // directly into `sql`) get misread by Postgres as a row literal.
  await db.execute(sql`
    UPDATE spaces
       SET zone_id = ST_GeoHash(location::geometry, 6)
     WHERE zone_id = 'pending'
  `);

  // --- Space slots -------------------------------------------------------
  const slotRows: (typeof spaceSlots.$inferInsert)[] = [];
  const allSlotRefs: SlotRef[] = [];

  for (const spaceId of spaceIds) {
    const plan = plansBySpaceId.get(spaceId);
    if (plan === undefined) throw new Error(`seed-perf: missing plan for space ${spaceId}`);

    const slotCount = 1 + Math.floor(rng() * 6); // 1..6
    const counters: Record<'car' | 'two_wheeler', number> = { car: 0, two_wheeler: 0 };

    for (let k = 0; k < slotCount; k++) {
      let vehicleType: 'car' | 'two_wheeler';
      if (plan.car && plan.twoWheeler) {
        vehicleType = rng() < 0.6 ? 'car' : 'two_wheeler';
      } else {
        vehicleType = plan.car ? 'car' : 'two_wheeler';
      }
      const slotIndex = counters[vehicleType]++;
      slotRows.push({ id: uuidv7(), spaceId, vehicleType, slotIndex });
      allSlotRefs.push({ spaceId, vehicleType, slotIndex });
    }
  }

  for (const batch of chunk(slotRows, SLOT_BATCH)) {
    await db.insert(spaceSlots).values(batch);
  }

  // --- Bookings + booking_slots --------------------------------------------
  // Sample distinct (space, vehicle_type, slot_index) triples so no two
  // booking_slots share a key — that alone satisfies booking_slots_no_overlap
  // regardless of the generated period, since the exclusion constraint is
  // scoped to that same triple.
  shuffleInPlace(allSlotRefs, rng);
  const targetBookingSlots = Math.round(allSlotRefs.length * BOOKING_SLOT_FRACTION);
  const chosenSlots = allSlotRefs.slice(0, targetBookingSlots);

  const bookingRows: (typeof bookings.$inferInsert)[] = [];
  const bookingSlotRows: (typeof bookingSlots.$inferInsert)[] = [];
  const nowMs = now.getTime();

  for (let i = 0; i < chosenSlots.length; i++) {
    const slot = chosenSlots[i];
    if (slot === undefined) continue; // unreachable: i < chosenSlots.length

    const startOffsetMs = Math.floor(rng() * (DAY_MS - MIN_BOOKING_MS));
    const durationMs = MIN_BOOKING_MS + Math.floor(rng() * MAX_BOOKING_EXTRA_MS);
    const startsAt = new Date(nowMs + startOffsetMs);
    const endsAt = new Date(startsAt.getTime() + durationMs);
    const status = rng() < 0.7 ? 'confirmed' : 'active';

    const basePaise = toPaise(1_000 + Math.floor(rng() * 5_000));
    const parkeaseFeePaise = mulRate(basePaise, PLATFORM_COMMISSION_RATE);
    const gstPaise = mulRate(parkeaseFeePaise, GST_RATE);
    const surgePremiumPaise = toPaise(0);
    const totalPaise = addPaise(basePaise, surgePremiumPaise, gstPaise);
    const ownerEarningsPaise = subPaise(basePaise, parkeaseFeePaise);

    const bookingId = uuidv7();
    bookingRows.push({
      id: bookingId,
      driverId: pickFrom(driverIds, i),
      spaceId: slot.spaceId,
      vehicleType: slot.vehicleType,
      durationType: 'hourly',
      startsAt,
      endsAt,
      status,
      basePaise,
      surgePremiumPaise,
      surgeMultiplierBp: 10_000,
      parkeaseFeePaise,
      gstPaise,
      totalPaise,
      ownerEarningsPaise,
    });
    bookingSlotRows.push({
      id: uuidv7(),
      bookingId,
      spaceId: slot.spaceId,
      vehicleType: slot.vehicleType,
      slotIndex: slot.slotIndex,
      period: { start: startsAt, end: endsAt },
      status,
    });
  }

  for (const batch of chunk(bookingRows, BOOKING_BATCH)) {
    await db.insert(bookings).values(batch);
  }
  for (const batch of chunk(bookingSlotRows, BOOKING_SLOT_BATCH)) {
    await db.insert(bookingSlots).values(batch);
  }

  await db.execute(sql`ANALYZE spaces, space_slots, booking_slots, bookings`);

  return { spaceIds, bookingSlotCount: bookingSlotRows.length };
}
