import type { DriverValetJob, DriverWashJob } from '@parkease/contracts/driver';
import { driverValetJobSchema, driverWashJobSchema } from '@parkease/contracts/driver';

/** Wire-shaped add-on jobs, valid against the contracts, shared by the add-on suites. */
export const BOOKING_ID = '0192f1c0-1111-7000-8000-000000000001';
export const VALET_ID = '0192f1c0-2222-7000-8000-000000000001';
export const WASH_ID = '0192f1c0-3333-7000-8000-000000000001';

const leg = { distanceM: null, feePaise: null, txnId: null };

export const VALET_JOB_WIRE = {
  id: VALET_ID,
  bookingId: BOOKING_ID,
  status: 'offered',
  pickupAddress: 'Gate 2, Forum Mall',
  offerRadiusM: 3000,
  offerRound: 0,
  offeredTo: 3,
  outboundLeg: leg,
  returnLeg: leg,
  returnDropLocation: null,
  valet: null,
  contact: null,
  lastKnownLocation: null,
  cancellable: true,
  proofPhotoId: null,
  cancellationReason: null,
  requestedAt: '2026-10-12T04:30:00.000Z',
  acceptedAt: null,
  parkedAt: null,
  completedAt: null,
};

export const WASH_JOB_WIRE = {
  id: WASH_ID,
  bookingId: BOOKING_ID,
  status: 'accepted',
  serviceName: 'premium_wash',
  vehicleType: 'car',
  pricePaise: 40000,
  gstPaise: 7200,
  driverTotalPaise: 47200,
  offeredTo: 2,
  offerRadiusM: 3000,
  offerRound: 0,
  washer: null,
  beforePhotoId: null,
  afterPhotoId: null,
  cancellable: true,
  cancellationReason: null,
  requestedAt: '2026-10-12T04:30:00.000Z',
  acceptedAt: '2026-10-12T04:31:00.000Z',
  startedAt: null,
  completedAt: null,
};

export const valetJob = (
  overrides: Partial<Record<keyof typeof VALET_JOB_WIRE, unknown>> = {},
): DriverValetJob => driverValetJobSchema.parse({ ...VALET_JOB_WIRE, ...overrides });

export const washJob = (
  overrides: Partial<Record<keyof typeof WASH_JOB_WIRE, unknown>> = {},
): DriverWashJob => driverWashJobSchema.parse({ ...WASH_JOB_WIRE, ...overrides });
