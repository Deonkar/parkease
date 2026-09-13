import { describe, expect, it } from 'vitest';

import { countSlots, expandSlotRows } from '../src/domains/space/slots.js';

describe('expandSlotRows', () => {
  it('creates one row per slot', () => {
    const rows = expandSlotRows('space-1', { car: 2, twoWheeler: 3 });
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.vehicleType === 'car')).toHaveLength(2);
    expect(rows.filter((r) => r.vehicleType === 'two_wheeler')).toHaveLength(3);
  });

  it('assigns sequential slotIndex per vehicle type', () => {
    const rows = expandSlotRows('space-1', { car: 3, twoWheeler: 0 });
    expect(rows.map((r) => r.slotIndex)).toEqual([0, 1, 2]);
  });

  it('returns empty for zero slots', () => {
    expect(expandSlotRows('space-1', { car: 0, twoWheeler: 0 })).toEqual([]);
  });

  it('sets spaceId on every row', () => {
    const rows = expandSlotRows('abc', { car: 1, twoWheeler: 1 });
    for (const row of rows) {
      expect(row.spaceId).toBe('abc');
    }
  });
});

describe('countSlots', () => {
  it('counts by vehicle type', () => {
    const rows = [{ vehicleType: 'car' }, { vehicleType: 'car' }, { vehicleType: 'two_wheeler' }];
    expect(countSlots(rows)).toEqual({ car: 2, twoWheeler: 1 });
  });

  it('returns zeros for empty', () => {
    expect(countSlots([])).toEqual({ car: 0, twoWheeler: 0 });
  });
});
