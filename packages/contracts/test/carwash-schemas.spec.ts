import { describe, expect, it } from 'vitest';

import { requestCarwashSchema } from '../src/driver/index.js';
import {
  advanceWashJobSchema,
  attachWashPhotoSchema,
  createWasherProfileSchema,
  upsertWashServiceSchema,
  washerProfileViewSchema,
  washJobOfferSchema,
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
});

describe('createWasherProfileSchema', () => {
  it('requires a business name from a business partner', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        capabilities: ['car_wash'],
      }).success,
    ).toBe(false);

    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        businessName: 'Shine Co',
        capabilities: ['car_wash'],
      }).success,
    ).toBe(true);
  });

  it('does not require one from a gig partner', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'gig',
        capabilities: ['car_wash'],
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
      capabilities: ['car_wash'],
      aadhaarNumber: '1234 5678 9012',
    });

    expect(parsed).not.toHaveProperty('aadhaarNumber');
  });

  it('accepts operating hours as a weekday map', () => {
    const parsed = createWasherProfileSchema.parse({
      partnerType: 'business',
      businessName: 'Shine Co',
      capabilities: ['car_wash'],
      operatingHours: { mon: { open: '09:00', close: '18:00' } },
    });

    expect(parsed.operatingHours?.mon?.open).toBe('09:00');
  });

  it('refuses an operating hour that is not HH:mm', () => {
    expect(
      createWasherProfileSchema.safeParse({
        partnerType: 'business',
        businessName: 'Shine Co',
        capabilities: ['car_wash'],
        operatingHours: { mon: { open: '9am', close: '18:00' } },
      }).success,
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
