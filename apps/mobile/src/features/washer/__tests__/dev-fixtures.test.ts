import {
  CARWASH_TRANSITIONS,
  upsertWashServiceSchema,
  WASHER_EARNINGS_PERIOD_VALUES,
  washJobOfferSchema,
  washJobViewSchema,
  washerEarningsViewSchema,
  washerProfileViewSchema,
  washServiceMenuSchema,
  type WashJobView,
} from '@parkease/contracts/washer';
import { describe, expect, it } from 'vitest';

import {
  DEV_PLACEHOLDER_PHOTO_URI,
  DEV_WASHER_FIX,
  createWasherDevStore,
  devProofUploadId,
} from '../api/dev-fixtures';
import { apiErrorCodeOf, classifyFailure, httpStatusOf, serverMessageOf } from '../api/errors';
import { toMenuRows } from '../menu-rows';

/**
 * The fixtures the washer screens serve under a dev-mock session (ruling
 * T11-W1). Every value is built through the real contract schema, so a fixture
 * that drifts from the contract fails here rather than on a screen.
 */

const NOW = Date.parse('2026-09-24T06:30:00.000Z');
const fresh = () => createWasherDevStore(() => NOW);

/**
 * The events a washer may fire from a status, read off the contracts table —
 * not a list this test keeps. `cancel` is the driver's, `offer` and `accept`
 * are dispatch's (`advanceWashJobSchema` excludes the same three).
 */
const fromTable = (job: WashJobView) =>
  Object.keys(CARWASH_TRANSITIONS[job.status]).filter(
    (event) => event !== 'cancel' && event !== 'offer' && event !== 'accept',
  );

const firstOffer = (store: ReturnType<typeof fresh>) => {
  const [offer] = store.offers();
  if (offer === undefined) throw new Error('no fixture offer');
  return offer;
};

describe('every fixture parses through its contract schema', () => {
  it('offers', () => {
    expect(() => washJobOfferSchema.array().parse(fresh().offers())).not.toThrow();
  });

  it('the service menu', () => {
    expect(() => washServiceMenuSchema.parse(fresh().menu())).not.toThrow();
  });

  it('earnings, for every period', () => {
    const store = fresh();
    for (const period of WASHER_EARNINGS_PERIOD_VALUES) {
      expect(() => washerEarningsViewSchema.parse(store.earnings(period))).not.toThrow();
    }
  });

  it('the profile', () => {
    expect(() => washerProfileViewSchema.parse(fresh().profile())).not.toThrow();
  });

  it('the active job', () => {
    const store = fresh();
    const job = store.accept(firstOffer(store).jobId);
    expect(() => washJobViewSchema.parse(job)).not.toThrow();
  });
});

describe('the states the fixtures exist to show', () => {
  it('is a verified partner, offline until they go online', () => {
    const store = fresh();
    expect(store.profile().verificationStatus).toBe('verified');
    expect(store.profile().isOnline).toBe(false);

    store.setOnline(true);
    expect(store.profile().isOnline).toBe(true);
  });

  it('has two or three offers that differ in service, vehicle, distance and expiry', () => {
    const offers = fresh().offers();

    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.length).toBeLessThanOrEqual(3);
    expect(new Set(offers.map((o) => o.serviceName)).size).toBe(offers.length);
    expect(new Set(offers.map((o) => o.vehicleType)).size).toBe(2);
    expect(new Set(offers.map((o) => o.distanceM)).size).toBe(offers.length);
    expect(new Set(offers.map((o) => o.expiresAt)).size).toBe(offers.length);
    for (const offer of offers) {
      const minutesLeft = (Date.parse(offer.expiresAt) - NOW) / 60_000;
      expect(minutesLeft).toBeGreaterThan(0);
      expect(minutesLeft).toBeLessThanOrEqual(15);
    }
  });

  it('opens a new offer round once every offer has expired', () => {
    let now = NOW;
    const store = createWasherDevStore(() => now);
    const first = store.offers();

    now = NOW + 60 * 60_000;
    const later = store.offers();

    expect(later).toHaveLength(first.length);
    for (const offer of later) expect(Date.parse(offer.expiresAt)).toBeGreaterThan(now);
  });

  it('shows every menu row state: active, switched off, and never priced', () => {
    const rows = toMenuRows(fresh().menu().services);

    expect(rows.some((row) => row.isActive && row.carPricePaise !== null)).toBe(true);
    expect(rows.some((row) => !row.isActive && row.carPricePaise !== null)).toBe(true);
    expect(rows.some((row) => row.carPricePaise === null && row.bikePricePaise === null)).toBe(
      true,
    );
  });

  it('offers only services the partner prices and has switched on', () => {
    const store = fresh();
    const live = store.menu().services.filter((s) => s.isActive);
    for (const offer of store.offers()) {
      expect(
        live.some(
          (s) => s.serviceName === offer.serviceName && s.vehicleType === offer.vehicleType,
        ),
      ).toBe(true);
    }
  });

  it('prices a never-priced service through the whole-menu upsert', () => {
    const store = fresh();
    const before = store.menu().services.length;

    const menu = store.upsert(
      'quick_wipe',
      upsertWashServiceSchema.parse({
        carPricePaise: 19_900,
        bikePricePaise: 9_900,
        durationMinutes: 15,
        isActive: true,
      }),
    );

    expect(menu.services).toHaveLength(before + 2);
    expect(toMenuRows(menu.services).find((r) => r.serviceName === 'quick_wipe')).toMatchObject({
      carPricePaise: 19_900,
      bikePricePaise: 9_900,
      durationMinutes: 15,
      isActive: true,
    });
  });

  it('has an empty period, and a week with lines and a reversal', () => {
    const store = fresh();

    expect(store.earnings('today').lines).toHaveLength(0);
    const week = store.earnings('week');
    expect(week.lines.length).toBeGreaterThan(0);
    expect(week.summary.reversedPaise).toBeGreaterThan(0);
  });

  it('answers each period with that period', () => {
    const store = fresh();
    for (const period of WASHER_EARNINGS_PERIOD_VALUES) {
      expect(store.earnings(period).period).toBe(period);
    }
  });
});

describe('walking a job, offer to earnings', () => {
  it('moves through the real transition table, one button at a time', () => {
    const store = fresh();
    const offer = firstOffer(store);

    // Accept: the job is live and the offer list hides.
    let job = store.accept(offer.jobId);
    expect(job.status).toBe('accepted');
    expect(job.earningsPaise).toBe(offer.earningsPaise);
    expect(job.availableEvents).toEqual(fromTable(job));
    expect(job.availableEvents).toEqual(['en_route']);
    expect(store.active()).toEqual(job);
    expect(store.offers()).toEqual([]);

    job = store.advance(job.id, 'en_route');
    expect(job.status).toBe('en_route');
    expect(job.availableEvents).toEqual(fromTable(job));
    expect(job.availableEvents).toEqual(['start_washing']);

    // The server refuses Start Washing without the before photo, and the
    // after slot is not open yet.
    expect(() => store.advance(job.id, 'start_washing')).toThrow();
    expect(() => store.attach(job.id, 'after', devProofUploadId('after'))).toThrow();

    job = store.attach(job.id, 'before', devProofUploadId('before'));
    expect(job.beforePhotoId).toBe(devProofUploadId('before'));
    expect(job.status).toBe('en_route');

    job = store.advance(job.id, 'start_washing');
    expect(job.status).toBe('washing');
    expect(job.startedAt).not.toBeNull();
    expect(job.availableEvents).toEqual(fromTable(job));
    expect(job.availableEvents).toEqual(['complete']);

    // Washing has begun: the before photo is the record now.
    expect(() => store.attach(job.id, 'before', 'another-photo')).toThrow();
    expect(() => store.advance(job.id, 'complete')).toThrow();

    job = store.attach(job.id, 'after', devProofUploadId('after'));
    expect(job.afterPhotoId).toBe(devProofUploadId('after'));

    job = store.advance(job.id, 'complete');
    expect(job.status).toBe('completed');
    expect(job.completedAt).not.toBeNull();
    expect(job.availableEvents).toEqual(fromTable(job));
    expect(job.availableEvents).toEqual([]);

    // No longer live, and on the earnings screen.
    expect(store.active()).toBeNull();
    expect(store.earnings('today').lines.map((line) => line.jobId)).toEqual([job.id]);
    expect(store.earnings('today').summary.jobsCompleted).toBe(1);
    expect(store.earnings('week').lines.map((line) => line.jobId)).toContain(job.id);
    expect(store.earnings('all').lines.map((line) => line.jobId)).toContain(job.id);

    // The accepted offer is gone for good; the others come back.
    expect(store.offers().map((o) => o.jobId)).not.toContain(offer.jobId);
    expect(store.offers().length).toBeGreaterThan(0);
  });

  it('refuses an event the table does not allow from here', () => {
    const store = fresh();
    const job = store.accept(firstOffer(store).jobId);

    expect(() => store.advance(job.id, 'complete')).toThrow();
    expect(store.active()?.status).toBe('accepted');
  });

  it('refuses an offer it never made', () => {
    expect(() => fresh().accept('0192f2a1-0000-7000-8000-0000000000ff')).toThrow();
  });
});

describe('the stand-ins for hardware the preview has not got', () => {
  it('a placeholder photo that needs no camera', () => {
    expect(DEV_PLACEHOLDER_PHOTO_URI.startsWith('data:image/svg+xml,')).toBe(true);
  });

  it('a fixture coordinate for presence, in Bengaluru', () => {
    expect(DEV_WASHER_FIX.lat).toBeGreaterThan(12);
    expect(DEV_WASHER_FIX.lat).toBeLessThan(14);
    expect(DEV_WASHER_FIX.lng).toBeGreaterThan(77);
    expect(DEV_WASHER_FIX.lng).toBeLessThan(78);
  });
});

/**
 * I7: the dev-mock store refuses the way the API does — the error envelope,
 * with the server's status and code — so the preview walks the SAME failure
 * paths as production: the classifier, the outcome copy, the refetch.
 */
describe('the store s refusals', () => {
  const caught = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error('expected the store to refuse');
  };

  const expectRefusal = (error: unknown, status: number, code: string) => {
    expect(apiErrorCodeOf(error)).toBe(code);
    expect(httpStatusOf(error)).toBe(status);
    expect(classifyFailure(error)).toBe('refused');
    expect(serverMessageOf(error)).not.toBeNull();
    expect(error).toBeInstanceOf(Error);
  };

  it('refuses a start without the before photo as 400 BEFORE_PHOTO_REQUIRED', () => {
    const store = fresh();
    const job = store.advance(store.accept(firstOffer(store).jobId).id, 'en_route');
    expectRefusal(
      caught(() => store.advance(job.id, 'start_washing')),
      400,
      'BEFORE_PHOTO_REQUIRED',
    );
  });

  it('refuses an event the table does not allow as 409 ILLEGAL_CARWASH_TRANSITION', () => {
    const store = fresh();
    const job = store.accept(firstOffer(store).jobId);
    expectRefusal(
      caught(() => store.advance(job.id, 'complete')),
      409,
      'ILLEGAL_CARWASH_TRANSITION',
    );
  });

  it('refuses a closed slot as 409 PHOTO_SLOT_CLOSED', () => {
    const store = fresh();
    const job = store.accept(firstOffer(store).jobId);
    expectRefusal(
      caught(() => store.attach(job.id, 'after', devProofUploadId('after'))),
      409,
      'PHOTO_SLOT_CLOSED',
    );
  });

  it('refuses an offer that is gone as 409 WASH_JOB_TAKEN', () => {
    expectRefusal(
      caught(() => fresh().accept('0192f2a1-0000-7000-8000-0000000000ff')),
      409,
      'WASH_JOB_TAKEN',
    );
  });
});
