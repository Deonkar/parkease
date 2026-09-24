import type { CarwashJobEvent, CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import {
  IllegalCarwashTransitionError,
  LIVE_CARWASH_STATUSES,
  PHOTO_SLOT_OPEN_STATUSES,
  WASHER_EARNINGS_PERIOD_VALUES,
  advanceWashJobSchema,
  nextCarwashStatus,
  washJobOfferSchema,
  washJobViewSchema,
  washerEarningsViewSchema,
  washerProfileViewSchema,
  washServiceMenuSchema,
  type UpsertWashService,
  type WashJobOffer,
  type WashJobView,
  type WashServiceMenu,
  type WasherEarningsPeriod,
  type WasherEarningsView,
  type WasherProfileView,
} from '@parkease/contracts/washer';
import { colors } from '@parkease/tokens';

/**
 * What the washer screens serve under a dev-mock session, so every screen can
 * be opened and walked in the browser preview with no API, no database and no
 * phone OTP (ruling T11-W1). Engaged only through `isWasherDevMock()`, which
 * requires `__DEV__` — never reachable in a release build.
 *
 * Copied from driver's `dev-fixtures.ts` and owner's dev store, not imported
 * (R-ARCH-01), with one rule of its own: EVERY value is built through the real
 * contract schema, on every read, so a fixture cannot drift from the contract
 * without a test failing (`dev-fixtures.test.ts`).
 *
 * Money is fixed integer paise literals, and nothing below does arithmetic on
 * any of it (R-FE-06). A completed job's line carries the three amounts its
 * offer seed was written with; the period summaries stay as written, which the
 * contract allows — summary and lines count by different instants and "need
 * not sum" (`washerEarningsViewSchema`).
 *
 * The job's `availableEvents` come from the contracts transition table exactly
 * as the API derives them, so the one button the active screen renders is the
 * one the server would have offered.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Koramangala, Bengaluru — where the fixture partner is when the browser has no location. */
export const DEV_WASHER_FIX = { lat: 12.9352, lng: 77.6245 } as const;

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">' +
  `<rect width="480" height="360" fill="${colors.primarySoft}"/>` +
  '<text x="240" y="188" font-family="sans-serif" font-size="24" text-anchor="middle" ' +
  `fill="${colors.primaryDark}">Dev preview photo</text></svg>`;

/** What the camera "takes" in a preview with no camera. Needs no upload and no network. */
export const DEV_PLACEHOLDER_PHOTO_URI = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`;

/** The upload id a dev-mock capture attaches in place of a Cloudinary `public_id`. */
export function devProofUploadId(slot: 'before' | 'after'): string {
  return `dev-mock-proof-${slot}`;
}

interface OfferSeed {
  readonly jobId: string;
  readonly bookingId: string;
  readonly serviceName: CarwashServiceName;
  readonly vehicleType: VehicleType;
  readonly spaceLocation: { readonly lat: number; readonly lng: number };
  readonly distanceM: number;
  readonly expiresInMinutes: number;
  /** The partner's take-home, as the card shows it — the same figure as `line.netPaise`. */
  readonly earningsPaise: number;
  /** The earnings line this job becomes once completed. Literals, never derived. */
  readonly line: {
    readonly grossPaise: number;
    readonly feePaise: number;
    readonly netPaise: number;
  };
}

/** Three offers: every one a service this partner prices and has switched on. */
const OFFER_SEEDS: readonly OfferSeed[] = [
  {
    jobId: '0192f2a1-0000-7000-8000-00000000a001',
    bookingId: '0192f2a1-0000-7000-8000-00000000b001',
    serviceName: 'basic_exterior',
    vehicleType: 'car',
    spaceLocation: { lat: 12.9391, lng: 77.627 },
    distanceM: 480,
    expiresInMinutes: 4,
    earningsPaise: 23_920,
    line: { grossPaise: 29_900, feePaise: 5_980, netPaise: 23_920 },
  },
  {
    jobId: '0192f2a1-0000-7000-8000-00000000a002',
    bookingId: '0192f2a1-0000-7000-8000-00000000b002',
    serviceName: 'premium_wash',
    vehicleType: 'two_wheeler',
    spaceLocation: { lat: 12.9279, lng: 77.6271 },
    distanceM: 1_850,
    expiresInMinutes: 7,
    earningsPaise: 19_920,
    line: { grossPaise: 24_900, feePaise: 4_980, netPaise: 19_920 },
  },
  {
    jobId: '0192f2a1-0000-7000-8000-00000000a003',
    bookingId: '0192f2a1-0000-7000-8000-00000000b003',
    serviceName: 'full_detailing',
    vehicleType: 'car',
    spaceLocation: { lat: 12.9165, lng: 77.6101 },
    distanceM: 3_600,
    expiresInMinutes: 10,
    earningsPaise: 119_920,
    line: { grossPaise: 149_900, feePaise: 29_980, netPaise: 119_920 },
  },
];

/**
 * Eight stored rows for five services: `interior_only` is priced but switched
 * off, and `quick_wipe` has never been priced (no rows at all), so the menu
 * screen shows every row state. Saving `quick_wipe` makes it ten.
 */
const MENU_SEED = {
  services: [
    {
      serviceName: 'basic_exterior',
      vehicleType: 'car',
      pricePaise: 29_900,
      durationMinutes: 30,
      isActive: true,
    },
    {
      serviceName: 'basic_exterior',
      vehicleType: 'two_wheeler',
      pricePaise: 14_900,
      durationMinutes: 20,
      isActive: true,
    },
    {
      serviceName: 'premium_wash',
      vehicleType: 'car',
      pricePaise: 49_900,
      durationMinutes: 45,
      isActive: true,
    },
    {
      serviceName: 'premium_wash',
      vehicleType: 'two_wheeler',
      pricePaise: 24_900,
      durationMinutes: 45,
      isActive: true,
    },
    {
      serviceName: 'interior_only',
      vehicleType: 'car',
      pricePaise: 39_900,
      durationMinutes: 40,
      isActive: false,
    },
    {
      serviceName: 'interior_only',
      vehicleType: 'two_wheeler',
      pricePaise: 19_900,
      durationMinutes: 40,
      isActive: false,
    },
    {
      serviceName: 'full_detailing',
      vehicleType: 'car',
      pricePaise: 149_900,
      durationMinutes: 120,
      isActive: true,
    },
    {
      serviceName: 'full_detailing',
      vehicleType: 'two_wheeler',
      pricePaise: 69_900,
      durationMinutes: 120,
      isActive: true,
    },
  ],
} as const;

const iso = (ms: number) => new Date(ms).toISOString();

function seedEarnings(now: number): Record<WasherEarningsPeriod, WasherEarningsView> {
  const lineA = {
    jobId: '0192f2a1-0000-7000-8000-00000000c001',
    serviceName: 'basic_exterior',
    vehicleType: 'car',
    completedAt: iso(now - DAY_MS),
    grossPaise: 29_900,
    feePaise: 5_980,
    netPaise: 23_920,
  } as const;
  const lineB = {
    jobId: '0192f2a1-0000-7000-8000-00000000c002',
    serviceName: 'premium_wash',
    vehicleType: 'two_wheeler',
    completedAt: iso(now - 2 * DAY_MS),
    grossPaise: 24_900,
    feePaise: 4_980,
    netPaise: 19_920,
  } as const;
  const lineC = {
    jobId: '0192f2a1-0000-7000-8000-00000000c003',
    serviceName: 'full_detailing',
    vehicleType: 'car',
    completedAt: iso(now - 12 * DAY_MS),
    grossPaise: 149_900,
    feePaise: 29_980,
    netPaise: 119_920,
  } as const;
  const lineD = {
    jobId: '0192f2a1-0000-7000-8000-00000000c004',
    serviceName: 'basic_exterior',
    vehicleType: 'two_wheeler',
    completedAt: iso(now - 40 * DAY_MS),
    grossPaise: 14_900,
    feePaise: 2_980,
    netPaise: 11_920,
  } as const;

  return {
    // A new day: nothing yet — the empty state.
    today: washerEarningsViewSchema.parse({
      period: 'today',
      summary: { grossPaise: 0, reversedPaise: 0, netPaise: 0, jobsCompleted: 0 },
      lines: [],
    }),
    // A cancelled job clawed back ₹239.20, so the taken-back line shows.
    week: washerEarningsViewSchema.parse({
      period: 'week',
      summary: { grossPaise: 67_760, reversedPaise: 23_920, netPaise: 43_840, jobsCompleted: 2 },
      lines: [lineA, lineB],
    }),
    month: washerEarningsViewSchema.parse({
      period: 'month',
      summary: { grossPaise: 187_680, reversedPaise: 23_920, netPaise: 163_760, jobsCompleted: 3 },
      lines: [lineA, lineB, lineC],
    }),
    all: washerEarningsViewSchema.parse({
      period: 'all',
      summary: { grossPaise: 199_600, reversedPaise: 23_920, netPaise: 175_680, jobsCompleted: 4 },
      lines: [lineA, lineB, lineC, lineD],
    }),
  };
}

function seedProfile(): WasherProfileView {
  const hours = { open: '08:00', close: '20:00' };
  return washerProfileViewSchema.parse({
    partnerType: 'business',
    businessName: 'Sparkle Auto Spa',
    gstin: '29ABCDE1234F1Z5',
    businessPhotoIds: ['dev-mock-business-front', 'dev-mock-business-bay'],
    operatingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours },
    capabilities: ['basic_exterior', 'premium_wash', 'interior_only', 'full_detailing'],
    idDocumentId: null,
    verificationStatus: 'verified',
    isOnline: false,
    lastSeenAt: null,
    ratingAvgBp: 46_000,
    ratingCount: 38,
  });
}

/**
 * The events a washer may fire from `status`, derived exactly as the API's
 * `availableEventsFor` derives them: the events `advanceWashJobSchema` lets a
 * washer send, filtered by the contracts transition table.
 */
function eventsFrom(status: WashJobView['status']): string[] {
  return advanceWashJobSchema.shape.event.options.filter(
    (event) => nextCarwashStatus(status, event) !== null,
  );
}

export interface WasherDevStore {
  offers(): WashJobOffer[];
  active(): WashJobView | null;
  accept(jobId: string): WashJobView;
  advance(jobId: string, event: CarwashJobEvent): WashJobView;
  attach(jobId: string, slot: 'before' | 'after', photoId: string): WashJobView;
  earnings(period: WasherEarningsPeriod): WasherEarningsView;
  menu(): WashServiceMenu;
  upsert(serviceName: CarwashServiceName, input: UpsertWashService): WashServiceMenu;
  profile(): WasherProfileView;
  setOnline(isOnline: boolean): void;
}

/**
 * A fresh store. `now` is injected so a test can walk expiry; the app uses the
 * one shared store below. In memory only: a reload starts the walk again.
 */
export function createWasherDevStore(now: () => number = Date.now): WasherDevStore {
  let roundStartedAt = now();
  let profile = seedProfile();
  let menu = washServiceMenuSchema.parse(MENU_SEED);
  const earnings = seedEarnings(now());
  const taken = new Set<string>();
  let job: { view: WashJobView; seed: OfferSeed } | null = null;

  const expiresAt = (seed: OfferSeed) => roundStartedAt + seed.expiresInMinutes * MINUTE_MS;
  const openSeeds = () =>
    OFFER_SEEDS.filter((seed) => !taken.has(seed.jobId) && expiresAt(seed) > now());
  const live = () => (job !== null && LIVE_CARWASH_STATUSES.includes(job.view.status) ? job : null);

  const toOffer = (seed: OfferSeed): WashJobOffer =>
    washJobOfferSchema.parse({
      jobId: seed.jobId,
      bookingId: seed.bookingId,
      serviceName: seed.serviceName,
      vehicleType: seed.vehicleType,
      spaceLocation: seed.spaceLocation,
      distanceM: seed.distanceM,
      earningsPaise: seed.earningsPaise,
      offeredAt: iso(roundStartedAt),
      expiresAt: iso(expiresAt(seed)),
    });

  /** Re-parsed on every write, with `availableEvents` re-derived from the table. */
  const write = (seed: OfferSeed, fields: Record<string, unknown>): WashJobView => {
    const base = job?.seed === seed ? job.view : {};
    const draft = washJobViewSchema.omit({ availableEvents: true }).parse({ ...base, ...fields });
    const view = washJobViewSchema.parse({ ...draft, availableEvents: eventsFrom(draft.status) });
    job = { view, seed };
    return view;
  };

  const current = (jobId: string) => {
    const held = live();
    if (held?.view.id !== jobId) {
      throw new Error(`dev-fixtures: ${jobId} is not the partner's live wash`);
    }
    return held;
  };

  const recordCompleted = (view: WashJobView, seed: OfferSeed) => {
    const line = {
      jobId: view.id,
      serviceName: view.serviceName,
      vehicleType: view.vehicleType,
      completedAt: view.completedAt,
      grossPaise: seed.line.grossPaise,
      feePaise: seed.line.feePaise,
      netPaise: seed.line.netPaise,
    };
    for (const period of WASHER_EARNINGS_PERIOD_VALUES) {
      const shown = earnings[period];
      earnings[period] = washerEarningsViewSchema.parse({
        ...shown,
        // A count of jobs, not money.
        summary: { ...shown.summary, jobsCompleted: shown.summary.jobsCompleted + 1 },
        lines: [line, ...shown.lines],
      });
    }
  };

  return {
    offers() {
      // One live job per partner: while there is one, there are no offers.
      if (live() !== null) return [];
      // Every offer lapsed: dispatch opens a new round, so the walk never dead-ends.
      if (openSeeds().length === 0) roundStartedAt = now();
      return openSeeds().map(toOffer);
    },

    active() {
      return live()?.view ?? null;
    },

    accept(jobId) {
      if (live() !== null) throw new Error('dev-fixtures: the partner already has a live wash');
      const seed = openSeeds().find((candidate) => candidate.jobId === jobId);
      if (seed === undefined) throw new Error(`dev-fixtures: no open offer ${jobId}`);
      taken.add(seed.jobId);
      job = null;
      return write(seed, {
        id: seed.jobId,
        bookingId: seed.bookingId,
        status: 'accepted',
        serviceName: seed.serviceName,
        vehicleType: seed.vehicleType,
        spaceLocation: seed.spaceLocation,
        earningsPaise: seed.earningsPaise,
        beforePhotoId: null,
        afterPhotoId: null,
        acceptedAt: iso(now()),
        startedAt: null,
        completedAt: null,
      });
    },

    advance(jobId, event) {
      const held = current(jobId);
      const { view, seed } = held;
      const to = eventsFrom(view.status).includes(event)
        ? nextCarwashStatus(view.status, event)
        : null;
      if (to === null) throw new IllegalCarwashTransitionError(view.status, event);
      // The server's photo gate (§13.8), so the preview cannot skip a photo either.
      if (event === 'start_washing' && view.beforePhotoId === null) {
        throw new Error('dev-fixtures: BEFORE_PHOTO_REQUIRED');
      }
      if (event === 'complete' && view.afterPhotoId === null) {
        throw new Error('dev-fixtures: AFTER_PHOTO_REQUIRED');
      }

      const stamped =
        to === 'washing'
          ? { startedAt: iso(now()) }
          : to === 'completed'
            ? { completedAt: iso(now()) }
            : {};
      const next = write(seed, { status: to, ...stamped });
      if (to === 'completed') recordCompleted(next, seed);
      return next;
    },

    attach(jobId, slot, photoId) {
      const { view, seed } = current(jobId);
      if (!PHOTO_SLOT_OPEN_STATUSES[slot].includes(view.status)) {
        throw new Error(`dev-fixtures: PHOTO_SLOT_CLOSED for the ${slot} photo`);
      }
      return write(
        seed,
        slot === 'before' ? { beforePhotoId: photoId } : { afterPhotoId: photoId },
      );
    },

    earnings(period) {
      return earnings[period];
    },

    menu() {
      return menu;
    },

    upsert(serviceName, input) {
      const row = (vehicleType: VehicleType, pricePaise: number) => ({
        serviceName,
        vehicleType,
        pricePaise,
        durationMinutes: input.durationMinutes,
        isActive: input.isActive,
      });
      // The endpoint answers with the WHOLE menu; so does this.
      menu = washServiceMenuSchema.parse({
        services: [
          ...menu.services.filter((service) => service.serviceName !== serviceName),
          row('car', input.carPricePaise),
          row('two_wheeler', input.bikePricePaise),
        ],
      });
      return menu;
    },

    profile() {
      return profile;
    },

    setOnline(isOnline) {
      profile = washerProfileViewSchema.parse({ ...profile, isOnline, lastSeenAt: iso(now()) });
    },
  };
}

let shared: WasherDevStore | null = null;

/** The app's one store, created on first use so offer expiries count from then. */
export function washerDevStore(): WasherDevStore {
  shared ??= createWasherDevStore();
  return shared;
}
