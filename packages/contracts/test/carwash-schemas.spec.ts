import { describe, expect, it } from 'vitest';

import { requestCarwashSchema } from '../src/driver/index.js';
import {
  MAX_SERVICE_DURATION_MINUTES,
  MIN_SERVICE_DURATION_MINUTES,
  advanceWashJobSchema,
  attachWashPhotoSchema,
  createWasherProfileSchema,
  upsertWashServiceSchema,
  washerProfileViewSchema,
  washJobOfferSchema,
  washServiceSchema,
} from '../src/washer/index.js';

const UUID = '0192f3a1-0000-7000-8000-000000000001';

const VALID_PROFILE = {
  partnerType: 'gig',
  businessName: null,
  gstin: null,
  businessPhotoIds: [],
  operatingHours: null,
  capabilities: ['car_wash'],
  idDocumentId: null,
  verificationStatus: 'verified',
  isOnline: true,
  lastSeenAt: null,
  ratingAvgBp: null,
  ratingCount: 0,
};

describe('advanceWashJobSchema', () => {
  /**
   * The body names what the partner *did*, never where the job should land.
   * A client that can name a destination status is a client that can skip the
   * photo gates by asking for `completed` directly.
   */
  it('takes an event', () => {
    expect(advanceWashJobSchema.safeParse({ event: 'start_washing' }).success).toBe(true);
  });

  it('refuses a destination status', () => {
    expect(advanceWashJobSchema.safeParse({ status: 'washing' }).success).toBe(false);
    expect(advanceWashJobSchema.safeParse({ event: 'washing' }).success).toBe(false);
  });
});

describe('attachWashPhotoSchema', () => {
  /**
   * An upload id, never a URL and never bytes. Files go through `POST /uploads`,
   * which validates magic bytes rather than trusting a content type (R-VAL-01);
   * accepting a client-supplied URL would let a partner point the proof trail at
   * any image on the internet.
   */
  it('takes one upload id', () => {
    expect(attachWashPhotoSchema.safeParse({ photoId: 'wash/before/abc123' }).success).toBe(true);
  });

  it('refuses a URL and refuses an array', () => {
    expect(attachWashPhotoSchema.safeParse({ photoId: 'https://example.com/a.jpg' }).success).toBe(
      false,
    );
    expect(attachWashPhotoSchema.safeParse({ photoIds: ['a', 'b'] }).success).toBe(false);
  });
});

describe('upsertWashServiceSchema', () => {
  /**
   * §13.3. One UI row, two prices, two database rows. v1 stored one price and a
   * `vehicleType` that could be `BOTH`, which no pricing query could use and no
   * partner charging ₹399 for a car and ₹149 for a bike could express.
   */
  it('takes both vehicle-type prices in one edit', () => {
    const parsed = upsertWashServiceSchema.parse({
      carPricePaise: 44900,
      bikePricePaise: 17900,
      durationMinutes: 40,
      isActive: true,
    });

    expect(parsed.carPricePaise).toBe(44900);
    expect(parsed.bikePricePaise).toBe(17900);
  });

  it('refuses a single price with a vehicle type beside it', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        pricePaise: 44900,
        vehicleType: 'both',
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it('refuses a free service, which the ledger cannot post', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        carPricePaise: 0,
        bikePricePaise: 17900,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it('accepts the minimum price: ₹10 (1,000 paise)', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        carPricePaise: 1000,
        bikePricePaise: 1000,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('accepts the maximum price: ₹9,999 (999,900 paise)', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        carPricePaise: 999900,
        bikePricePaise: 999900,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('refuses a price below the minimum: 999 paise', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        carPricePaise: 999,
        bikePricePaise: 17900,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it('refuses a price above the maximum: 999,901 paise', () => {
    expect(
      upsertWashServiceSchema.safeParse({
        carPricePaise: 999901,
        bikePricePaise: 17900,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(false);
  });
});

describe('createWasherProfileSchema', () => {
  const PHOTO = ['spaces/shop-front'];

  it('requires a business name from a business partner', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        businessPhotoIds: PHOTO,
        capabilities: ['premium_wash'],
      }).success,
    ).toBe(false);

    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        businessName: 'Shine Co',
        businessPhotoIds: PHOTO,
        capabilities: ['premium_wash'],
      }).success,
    ).toBe(true);
  });

  /**
   * Ruling T10-C2. `businessName` is the name a partner trades under — a gig
   * partner's own name — and it is what a driver sees on the washer card.
   * Nothing else captures a display name, so a gig partner without one would
   * be a card that cannot be drawn.
   */
  it('requires a trading name from a gig partner too, on businessName', () => {
    const parsed = createWasherProfileSchema.safeParse({
      partnerType: 'gig',
      capabilities: ['premium_wash'],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['businessName']]);

    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'gig',
        businessName: 'Raju M.',
        capabilities: ['premium_wash'],
      }).success,
    ).toBe(true);
  });

  /**
   * Ruling T10-C1. A business registration is a complete submission — its
   * photos are what an admin reviews — so it must carry at least one.
   */
  it('refuses a business with no photo, on businessPhotoIds', () => {
    const parsed = createWasherProfileSchema.safeParse({
      partnerType: 'business',
      businessName: 'Shine Co',
      capabilities: ['premium_wash'],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['businessPhotoIds']]);
    expect(parsed.error?.issues[0]?.message).toMatch(/photo/i);
  });

  it('does not ask a gig partner for business photos', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'gig',
        businessName: 'Raju M.',
        capabilities: ['premium_wash'],
      }).success,
    ).toBe(true);
  });

  /**
   * security.md §5.3: the Aadhaar *number* is never collected, only an image an
   * admin looks at. There is no field here that could hold one.
   */
  it('has no field for an identity number', () => {
    const parsed = createWasherProfileSchema.parse({
      partnerType: 'gig',
      businessName: 'Raju M.',
      capabilities: ['premium_wash'],
      aadhaarNumber: '1234 5678 9012',
    });

    expect(parsed).not.toHaveProperty('aadhaarNumber');
  });

  it('accepts operating hours as a weekday map', () => {
    const parsed = createWasherProfileSchema.parse({
      partnerType: 'business',
      businessName: 'Shine Co',
      businessPhotoIds: PHOTO,
      capabilities: ['premium_wash'],
      operatingHours: { mon: { open: '09:00', close: '18:00' } },
    });

    expect(parsed.operatingHours?.mon?.open).toBe('09:00');
  });

  it('refuses an operating hour that is not HH:mm', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        businessName: 'Shine Co',
        businessPhotoIds: PHOTO,
        capabilities: ['premium_wash'],
        operatingHours: { mon: { open: '9am', close: '18:00' } },
      }).success,
    ).toBe(false);
  });
});

/**
 * Ruling T10-S1. What a partner ticks decides what they are offered, so the
 * list is the closed catalogue: a free string would let a typo (or a stale
 * client's 'car_wash') register a partner who silently offers nothing.
 */
describe('createWasherProfileSchema capabilities', () => {
  const gig = (capabilities: unknown) =>
    createWasherProfileSchema.safeParse({
      partnerType: 'gig',
      businessName: 'Raju M.',
      capabilities,
    });

  it('accepts every service in the catalogue', () => {
    expect(
      gig(['basic_exterior', 'premium_wash', 'interior_only', 'full_detailing', 'quick_wipe'])
        .success,
    ).toBe(true);
  });

  it('refuses a service outside the catalogue', () => {
    const parsed = gig(['car_wash']);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['capabilities', 0]);
  });

  it('refuses an empty list: a partner offering nothing is never dispatchable', () => {
    expect(gig([]).success).toBe(false);
  });

  it('refuses the same service twice, on the capabilities field', () => {
    const parsed = gig(['quick_wipe', 'quick_wipe']);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['capabilities']);
  });

  it('refuses more services than the catalogue holds', () => {
    expect(
      gig([
        'basic_exterior',
        'premium_wash',
        'interior_only',
        'full_detailing',
        'quick_wipe',
        'quick_wipe',
      ]).success,
    ).toBe(false);
  });
});

describe('washerProfileViewSchema', () => {
  it('accepts a valid profile', () => {
    expect(washerProfileViewSchema.safeParse(VALID_PROFILE).success).toBe(true);
  });

  /**
   * S-10 records `valetProfileViewSchema.verificationStatus` shipping as
   * `z.string()`, which leaves every consumer's switch defaulting on a typo
   * instead of failing typecheck. The washer view does not repeat it.
   */
  it('narrows verificationStatus to the enum rather than z.string()', () => {
    expect(
      washerProfileViewSchema.safeParse({ ...VALID_PROFILE, verificationStatus: 'nonsense' })
        .success,
    ).toBe(false);
  });

  it('narrows partnerType to the two it can be', () => {
    expect(
      washerProfileViewSchema.safeParse({ ...VALID_PROFILE, partnerType: 'agency' }).success,
    ).toBe(false);
  });
});

describe('washJobOfferSchema', () => {
  /**
   * An offer carries the partner's own earnings, not a fee and not the driver's
   * total: somebody deciding whether to take a job needs the number that lands
   * in their account. It comes from their menu, which is why an offer for a
   * service they do not price is not a thing that can exist.
   */
  it('carries a service name from the enum and the partner earnings', () => {
    const parsed = washJobOfferSchema.parse({
      jobId: UUID,
      bookingId: UUID,
      serviceName: 'premium_wash',
      vehicleType: 'car',
      spaceLocation: { lat: 12.97, lng: 77.59 },
      distanceM: 1200,
      earningsPaise: 31920,
      offeredAt: '2026-09-22T10:00:00.000Z',
      expiresAt: '2026-09-22T10:03:00.000Z',
    });

    expect(parsed.serviceName).toBe('premium_wash');
    expect(parsed.earningsPaise).toBe(31920);
  });

  it('refuses a service name outside the v1 catalogue', () => {
    expect(
      washJobOfferSchema.safeParse({
        jobId: UUID,
        bookingId: UUID,
        serviceName: 'ceramic_coating',
        vehicleType: 'car',
        spaceLocation: { lat: 12.97, lng: 77.59 },
        distanceM: 1200,
        earningsPaise: 31920,
        offeredAt: '2026-09-22T10:00:00.000Z',
        expiresAt: '2026-09-22T10:03:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('service duration bounds (T8-D1)', () => {
  /**
   * The mobile editor reads these to say what it accepts, so the numbers live
   * here once rather than as a 5 and a 480 typed into a screen.
   */
  const upsert = (durationMinutes: number) =>
    upsertWashServiceSchema.safeParse({
      carPricePaise: 44900,
      bikePricePaise: 17900,
      durationMinutes,
      isActive: true,
    }).success;

  const read = (durationMinutes: number) =>
    washServiceSchema.safeParse({
      serviceName: 'premium_wash',
      vehicleType: 'car',
      pricePaise: 44900,
      durationMinutes,
      isActive: true,
    }).success;

  it('names the bounds: 5 to 480 minutes', () => {
    expect(MIN_SERVICE_DURATION_MINUTES).toBe(5);
    expect(MAX_SERVICE_DURATION_MINUTES).toBe(480);
  });

  it.each([
    ['upsert', upsert],
    ['read', read],
  ] as const)('%s accepts 5 and 480, and refuses 4 and 481', (_name, parses) => {
    expect(parses(5)).toBe(true);
    expect(parses(480)).toBe(true);
    expect(parses(4)).toBe(false);
    expect(parses(481)).toBe(false);
  });
});

describe('washServiceSchema (read-side)', () => {
  /**
   * The read schema is looser than the write schema: it accepts any price > 0,
   * including those outside the ₹10–₹9,999 bounds. This prevents the menu
   * endpoint from throwing if an out-of-range row somehow exists.
   */
  it('accepts a stored price of 500 paise (below the write minimum)', () => {
    expect(
      washServiceSchema.safeParse({
        serviceName: 'premium_wash',
        vehicleType: 'car',
        pricePaise: 500,
        durationMinutes: 40,
        isActive: true,
      }).success,
    ).toBe(true);
  });
});

describe('requestCarwashSchema', () => {
  it('names the booking, the service and the vehicle type', () => {
    const parsed = requestCarwashSchema.parse({
      bookingId: UUID,
      serviceName: 'premium_wash',
      vehicleType: 'car',
    });

    expect(parsed.vehicleType).toBe('car');
  });

  /**
   * The client never computes or sends a price. It arrives from the winning
   * partner's menu at accept, and a request that could name one would be a
   * request that could name zero.
   */
  it('has no field for a price', () => {
    const parsed = requestCarwashSchema.parse({
      bookingId: UUID,
      serviceName: 'premium_wash',
      vehicleType: 'car',
      pricePaise: 1,
    });

    expect(parsed).not.toHaveProperty('pricePaise');
  });
});
