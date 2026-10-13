import { describe, expect, it } from 'vitest';

import { AvailabilityService } from '../src/domains/booking/availability.service.js';
import { SlotUnavailableError } from '../src/domains/booking/errors.js';

/**
 * S-105 / S-146: two racers' exclusion checks can deadlock (40P01) instead of one failing with
 * 23P01. Either way one driver lost the race for that slot, and both must answer the same 409.
 */
const txFailingInsertWith = (code: string) =>
  ({
    execute: async () => [{ slot_index: 0 }],
    insert: () => ({
      values: async () => {
        throw Object.assign(new Error(`failed: ${code}`), { code });
      },
    }),
  }) as never;

const input = {
  bookingId: '0192f1c0-0000-7000-8000-000000000001',
  spaceId: '0192f1c0-0000-7000-8000-000000000002',
  vehicleType: 'car' as const,
  startsAt: new Date('2026-10-10T10:00:00Z'),
  endsAt: new Date('2026-10-10T12:00:00Z'),
};

describe('a lost slot race', () => {
  it.each(['23P01', '40P01', '40001'])('answers SLOT_UNAVAILABLE for SQLSTATE %s', async (code) => {
    await expect(
      new AvailabilityService().allocate(txFailingInsertWith(code), input),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('lets any other database failure through as itself', async () => {
    await expect(
      new AvailabilityService().allocate(txFailingInsertWith('53300'), input),
    ).rejects.not.toBeInstanceOf(SlotUnavailableError);
  });
});
