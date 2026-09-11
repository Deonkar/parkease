import { z } from 'zod';

export const SLOT_STATUS_VALUES = ['held', 'confirmed', 'active', 'released'] as const;

export const slotStatusSchema = z.enum(SLOT_STATUS_VALUES);
export type SlotStatus = z.infer<typeof slotStatusSchema>;

export const SlotStatus = {
  HELD: 'held',
  CONFIRMED: 'confirmed',
  ACTIVE: 'active',
  RELEASED: 'released',
} as const satisfies Record<string, SlotStatus>;

type _MissingFromObject = Exclude<SlotStatus, (typeof SlotStatus)[keyof typeof SlotStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
