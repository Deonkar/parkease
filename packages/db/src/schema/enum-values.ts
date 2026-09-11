export const ROLE_VALUES = ['driver', 'owner', 'valet', 'washer', 'admin'] as const;

export const USER_STATUS_VALUES = ['active', 'blocked', 'deleted'] as const;

export const ROLE_STATUS_VALUES = ['active', 'pending', 'suspended', 'rejected'] as const;

export const VEHICLE_TYPE_VALUES = ['car', 'two_wheeler'] as const;

export const DURATION_TYPE_VALUES = ['hourly', 'daily', 'weekly', 'monthly'] as const;

export const APPROVAL_STATUS_VALUES = [
  'draft',
  'pending_review',
  'active',
  'changes_requested',
  'rejected',
  'paused',
] as const;

export const VERIFICATION_STATUS_VALUES = [
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;

export const BOOKING_STATUS_VALUES = [
  'pending_payment',
  'confirmed',
  'active',
  'completed',
  'cancelled',
  'expired',
  'no_show',
] as const;

export const SLOT_STATUS_VALUES = ['held', 'confirmed', 'active', 'released'] as const;

export const PAYMENT_STATUS_VALUES = [
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

export const REFUND_STATUS_VALUES = ['pending', 'processed', 'failed'] as const;

export const LEDGER_ACCOUNT_VALUES = [
  'driver_receivable',
  'owner_payable',
  'platform_revenue',
  'gst_payable',
  'tcs_payable',
  'tds_payable',
  'gateway_fees',
  'refunds_payable',
  'promo_expense',
] as const;

export const LEDGER_DIRECTION_VALUES = ['debit', 'credit'] as const;

export const PAYOUT_STATUS_VALUES = [
  'pending',
  'processing',
  'paid',
  'failed',
  'reversed',
] as const;

export const VALET_JOB_STATUS_VALUES = [
  'requested',
  'offered',
  'accepted',
  'en_route',
  'arrived',
  'parking',
  'parked',
  'return_requested',
  'returning',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const CARWASH_JOB_STATUS_VALUES = [
  'requested',
  'offered',
  'accepted',
  'en_route',
  'washing',
  'completed',
  'cancelled',
] as const;

export const NOTIFICATION_TYPE_VALUES = [
  'booking_confirmed',
  'booking_reminder',
  'booking_expired',
  'booking_cancelled',
  'valet_assigned',
  'valet_arrived',
  'valet_parked',
  'wash_accepted',
  'wash_completed',
  'payout_processed',
  'review_request',
  'space_approved',
  'space_rejected',
  'weekly_summary',
] as const;

export const OUTBOX_STATUS_VALUES = ['pending', 'dispatched', 'failed'] as const;
