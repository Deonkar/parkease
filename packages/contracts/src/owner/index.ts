export { createSpaceSchema, type CreateSpace, MAX_PHOTOS_PER_SPACE } from './create-space.js';
export { updateSpaceSchema, type UpdateSpace } from './update-space.js';
export {
  setSpacePhotosSchema,
  photoItemSchema,
  type SetSpacePhotos,
  type PhotoItem,
} from './set-space-photos.js';
export { spacePricingSchema, type SpacePricing, type DurationPricing } from './space-pricing.js';
export { spaceScheduleSchema, type SpaceSchedule, type DaySchedule } from './space-schedule.js';
export { slotCountsSchema, type SlotCounts, MAX_SLOTS_PER_VEHICLE_TYPE } from './slot-counts.js';
export {
  spaceSummarySchema,
  spaceDetailSchema,
  type SpaceSummary,
  type SpaceDetail,
  type PhotoResponse,
} from './space-detail.js';
export { ownerDashboardSchema, type OwnerDashboard } from './dashboard.js';
export {
  earningsQuerySchema,
  type EarningsQuery,
  earningEntrySchema,
  type EarningEntry,
} from './earnings.js';
export { payoutSchema, type Payout } from './payouts.js';
export {
  updateBankDetailsSchema,
  type UpdateBankDetails,
  bankDetailsResponseSchema,
  type BankDetailsResponse,
} from './bank-details.js';
export {
  ownerBookingsQuerySchema,
  type OwnerBookingsQuery,
  ownerBookingSchema,
  type OwnerBooking,
} from './bookings.js';
export { reviewResponseSchema, type ReviewResponse } from './review-response.js';
export {
  spaceSlotQuerySchema,
  type SpaceSlotQuery,
  spaceSlotSchema,
  type SpaceSlot,
} from './space-slots.js';
