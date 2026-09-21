export { valetJobOfferSchema, type ValetJobOffer } from './job-offer.js';
export { acceptValetJobSchema, type AcceptValetJob } from './accept-job.js';
export { uploadProofSchema, type UploadProof } from './upload-proof.js';
export { updateValetAvailabilitySchema, type UpdateValetAvailability } from './availability.js';
export {
  valetEarningsQuerySchema,
  type ValetEarningsQuery,
  valetEarningEntrySchema,
  type ValetEarningEntry,
} from './earnings.js';
export { uploadDocumentSchema, type UploadDocument } from './profile-documents.js';

export {
  VALET_TRANSITIONS,
  nextValetStatus,
  isTerminalValetStatus,
  valetHoldsVehicle,
  TRACKED_VALET_STATUSES,
  IllegalValetTransitionError,
} from './lifecycle.js';

export { advanceValetJobSchema, type AdvanceValetJob } from './advance-job.js';
export { setValetAvailabilitySchema, type SetValetAvailability } from './set-availability.js';
export {
  valetSubscribeSchema,
  type ValetSubscribe,
  valetLocationSchema,
  type ValetLocationUpdate,
  valetLocationViewSchema,
  type ValetLocationView,
  valetStatusEventSchema,
  type ValetStatusEvent,
  VALET_TRACKING_NAMESPACE,
  ValetSocketEvent,
} from './tracking-events.js';
export {
  valetOfferSchema,
  type ValetOffer,
  valetJobViewSchema,
  type ValetJobView,
  valetEarningsSummarySchema,
  type ValetEarningsSummary,
  valetProfileViewSchema,
  type ValetProfileView,
} from './job-view.js';
