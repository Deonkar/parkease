import { z } from 'zod';

/**
 * How a booking was checked in, not merely that it was. prd.md §6.1: an owner
 * scan is verification; a driver scanning their own QR proves nothing and is a
 * delayed fallback for unattended spaces. Disputes are settled from this value.
 */
export const CHECK_IN_METHOD_VALUES = ['owner_scan', 'driver_fallback'] as const;

export const checkInMethodSchema = z.enum(CHECK_IN_METHOD_VALUES);
export type CheckInMethod = z.infer<typeof checkInMethodSchema>;

export const CheckInMethod = {
  OWNER_SCAN: 'owner_scan',
  DRIVER_FALLBACK: 'driver_fallback',
} as const satisfies Record<string, CheckInMethod>;

type _MissingFromObject = Exclude<
  CheckInMethod,
  (typeof CheckInMethod)[keyof typeof CheckInMethod]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
