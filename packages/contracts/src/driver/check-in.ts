import { z } from 'zod';

/**
 * The scanned QR string. The booking id lives in the path, and the command
 * asserts the two agree: a validly signed token for a *different* booking must
 * not check that booking in just because its signature verifies.
 *
 * Bounded because it is attacker-supplied and reaches an HMAC: a megabyte of
 * "token" should be rejected by the schema, not hashed.
 */
export const bookingReferenceTokenSchema = z.string().min(1).max(256);

export const checkInSchema = z.object({
  token: bookingReferenceTokenSchema,
});

export type CheckIn = z.infer<typeof checkInSchema>;

/**
 * The unattended-space fallback. There is no token: the driver is not proving
 * anything, which is the whole reason the route is time-gated instead
 * (`startsAt` + 10 minutes) and recorded as `driver_fallback`.
 */
export const driverSelfCheckInSchema = z.object({});

export type DriverSelfCheckIn = z.infer<typeof driverSelfCheckInSchema>;
