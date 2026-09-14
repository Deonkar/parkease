import type { SlotCounts } from '@parkease/contracts/owner';

export interface SlotRow {
  readonly spaceId: string;
  readonly vehicleType: 'car' | 'two_wheeler';
  readonly slotIndex: number;
}

export function expandSlotRows(spaceId: string, counts: SlotCounts): SlotRow[] {
  const rows: SlotRow[] = [];

  for (let i = 0; i < counts.car; i++) {
    rows.push({ spaceId, vehicleType: 'car', slotIndex: i });
  }

  for (let i = 0; i < counts.twoWheeler; i++) {
    rows.push({ spaceId, vehicleType: 'two_wheeler', slotIndex: i });
  }

  return rows;
}

export function countSlots(slotRows: readonly { vehicleType: string }[]): {
  car: number;
  twoWheeler: number;
} {
  let car = 0;
  let twoWheeler = 0;
  for (const row of slotRows) {
    if (row.vehicleType === 'car') car++;
    else if (row.vehicleType === 'two_wheeler') twoWheeler++;
  }
  return { car, twoWheeler };
}
