import { describe, expect, it } from 'vitest';

import { createBookingSchema } from '../src/driver/create-booking.js';
import { indianPhoneSchema, vehicleNumberSchema, pincodeSchema } from '../src/primitives/indian.js';
import { paginationQuerySchema, errorEnvelopeSchema } from '../src/primitives/pagination.js';

describe('createBookingSchema', () => {
  const validBooking = {
    spaceId: '550e8400-e29b-41d4-a716-446655440000',
    vehicleType: 'car',
    durationType: 'hourly',
    startsAt: new Date(Date.now() + 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 7200_000).toISOString(),
  };

  it('accepts a valid booking', () => {
    const result = createBookingSchema.safeParse(validBooking);
    expect(result.success).toBe(true);
  });

  it('rejects endsAt <= startsAt', () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      endsAt: validBooking.startsAt,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const endAtIssue = result.error.issues.find((i) => i.path.includes('endsAt'));
      expect(endAtIssue?.message).toBe('End time must be after start time');
    }
  });

  it('rejects a start time more than a minute in the past', () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      startsAt: new Date(Date.now() - 120_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown vehicleType', () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      vehicleType: 'truck',
    });
    expect(result.success).toBe(false);
  });

  it('strips a client-supplied totalPaise', () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      totalPaise: 9999,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('totalPaise' in result.data).toBe(false);
    }
  });
});

describe('indianPhoneSchema', () => {
  it('accepts +919876543210', () => {
    expect(indianPhoneSchema.safeParse('+919876543210').success).toBe(true);
  });

  it('rejects 9876543210 (no prefix)', () => {
    expect(indianPhoneSchema.safeParse('9876543210').success).toBe(false);
  });

  it('rejects +911234567890 (starts with 1)', () => {
    expect(indianPhoneSchema.safeParse('+911234567890').success).toBe(false);
  });

  it('rejects +91987654321 (only 9 digits)', () => {
    expect(indianPhoneSchema.safeParse('+91987654321').success).toBe(false);
  });
});

describe('vehicleNumberSchema', () => {
  it('accepts KA-01-AB-1234', () => {
    expect(vehicleNumberSchema.safeParse('KA-01-AB-1234').success).toBe(true);
  });

  it('rejects KA01AB1234 (no dashes)', () => {
    expect(vehicleNumberSchema.safeParse('KA01AB1234').success).toBe(false);
  });
});

describe('pincodeSchema', () => {
  it('accepts 560001', () => {
    expect(pincodeSchema.safeParse('560001').success).toBe(true);
  });

  it('rejects 012345 (starts with 0)', () => {
    expect(pincodeSchema.safeParse('012345').success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults limit to 20', () => {
    const result = paginationQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('rejects limit 101', () => {
    expect(paginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  it('accepts an uppercase code', () => {
    const result = errorEnvelopeSchema.safeParse({
      error: { code: 'BOOKING_NOT_FOUND', message: 'Not found', traceId: 'abc123' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a lowercase code', () => {
    const result = errorEnvelopeSchema.safeParse({
      error: { code: 'booking_not_found', message: 'Not found', traceId: 'abc123' },
    });
    expect(result.success).toBe(false);
  });
});
