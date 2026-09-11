import { describe, expect, it } from 'vitest';

import {
  ROLE_VALUES,
  Role,
  roleSchema,
  VEHICLE_TYPE_VALUES,
  VehicleType,
  vehicleTypeSchema,
  BOOKING_STATUS_VALUES,
  BookingStatus,
  bookingStatusSchema,
  DURATION_TYPE_VALUES,
  DurationType,
  durationTypeSchema,
  APPROVAL_STATUS_VALUES,
  ApprovalStatus,
  approvalStatusSchema,
  VERIFICATION_STATUS_VALUES,
  VerificationStatus,
  verificationStatusSchema,
  VALET_JOB_STATUS_VALUES,
  ValetJobStatus,
  valetJobStatusSchema,
  CARWASH_JOB_STATUS_VALUES,
  CarwashJobStatus,
  carwashJobStatusSchema,
  PAYOUT_STATUS_VALUES,
  PayoutStatus,
  payoutStatusSchema,
  LEDGER_ACCOUNT_VALUES,
  LedgerAccount,
  ledgerAccountSchema,
  NOTIFICATION_TYPE_VALUES,
  NotificationType,
  notificationTypeSchema,
  USER_STATUS_VALUES,
  UserStatus,
  userStatusSchema,
  ROLE_STATUS_VALUES,
  RoleStatus,
  roleStatusSchema,
  SLOT_STATUS_VALUES,
  SlotStatus,
  slotStatusSchema,
  PAYMENT_STATUS_VALUES,
  PaymentStatus,
  paymentStatusSchema,
  REFUND_STATUS_VALUES,
  RefundStatus,
  refundStatusSchema,
  LEDGER_DIRECTION_VALUES,
  LedgerDirection,
  ledgerDirectionSchema,
  OUTBOX_STATUS_VALUES,
  OutboxStatus,
  outboxStatusSchema,
} from '../src/enums/index.js';

const allEnums = [
  { name: 'Role', values: ROLE_VALUES, obj: Role, schema: roleSchema },
  { name: 'VehicleType', values: VEHICLE_TYPE_VALUES, obj: VehicleType, schema: vehicleTypeSchema },
  {
    name: 'BookingStatus',
    values: BOOKING_STATUS_VALUES,
    obj: BookingStatus,
    schema: bookingStatusSchema,
  },
  {
    name: 'DurationType',
    values: DURATION_TYPE_VALUES,
    obj: DurationType,
    schema: durationTypeSchema,
  },
  {
    name: 'ApprovalStatus',
    values: APPROVAL_STATUS_VALUES,
    obj: ApprovalStatus,
    schema: approvalStatusSchema,
  },
  {
    name: 'VerificationStatus',
    values: VERIFICATION_STATUS_VALUES,
    obj: VerificationStatus,
    schema: verificationStatusSchema,
  },
  {
    name: 'ValetJobStatus',
    values: VALET_JOB_STATUS_VALUES,
    obj: ValetJobStatus,
    schema: valetJobStatusSchema,
  },
  {
    name: 'CarwashJobStatus',
    values: CARWASH_JOB_STATUS_VALUES,
    obj: CarwashJobStatus,
    schema: carwashJobStatusSchema,
  },
  {
    name: 'PayoutStatus',
    values: PAYOUT_STATUS_VALUES,
    obj: PayoutStatus,
    schema: payoutStatusSchema,
  },
  {
    name: 'LedgerAccount',
    values: LEDGER_ACCOUNT_VALUES,
    obj: LedgerAccount,
    schema: ledgerAccountSchema,
  },
  {
    name: 'NotificationType',
    values: NOTIFICATION_TYPE_VALUES,
    obj: NotificationType,
    schema: notificationTypeSchema,
  },
  { name: 'UserStatus', values: USER_STATUS_VALUES, obj: UserStatus, schema: userStatusSchema },
  { name: 'RoleStatus', values: ROLE_STATUS_VALUES, obj: RoleStatus, schema: roleStatusSchema },
  { name: 'SlotStatus', values: SLOT_STATUS_VALUES, obj: SlotStatus, schema: slotStatusSchema },
  {
    name: 'PaymentStatus',
    values: PAYMENT_STATUS_VALUES,
    obj: PaymentStatus,
    schema: paymentStatusSchema,
  },
  {
    name: 'RefundStatus',
    values: REFUND_STATUS_VALUES,
    obj: RefundStatus,
    schema: refundStatusSchema,
  },
  {
    name: 'LedgerDirection',
    values: LEDGER_DIRECTION_VALUES,
    obj: LedgerDirection,
    schema: ledgerDirectionSchema,
  },
  {
    name: 'OutboxStatus',
    values: OUTBOX_STATUS_VALUES,
    obj: OutboxStatus,
    schema: outboxStatusSchema,
  },
] as const;

describe('enums', () => {
  it.each(allEnums)(
    '$name: const object values equal Zod schema options (order-independent)',
    ({ obj, schema }) => {
      const objectValues = new Set(Object.values(obj));
      const schemaOptions = new Set(schema.options);
      expect(objectValues).toEqual(schemaOptions);
    },
  );

  it.each(allEnums)('$name: schema rejects an unknown value', ({ schema }) => {
    const result = schema.safeParse('INVALID_VALUE_THAT_DOES_NOT_EXIST');
    expect(result.success).toBe(false);
  });

  it('all 18 enum types are tested', () => {
    expect(allEnums).toHaveLength(18);
  });
});

describe('ledger accounts match ADR-008 chart of accounts', () => {
  it('includes tcs_payable and tds_payable', () => {
    expect(LEDGER_ACCOUNT_VALUES).toContain('tcs_payable');
    expect(LEDGER_ACCOUNT_VALUES).toContain('tds_payable');
  });

  it('has exactly the expected accounts', () => {
    const expected = new Set([
      'driver_receivable',
      'owner_payable',
      'platform_revenue',
      'gst_payable',
      'tcs_payable',
      'tds_payable',
      'gateway_fees',
      'refunds_payable',
      'promo_expense',
    ]);
    expect(new Set(LEDGER_ACCOUNT_VALUES)).toEqual(expected);
  });
});
