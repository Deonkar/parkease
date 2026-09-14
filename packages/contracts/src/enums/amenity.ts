import { z } from 'zod';

export const AMENITY_VALUES = [
  'covered',
  'cctv',
  'guarded',
  'ev_charging',
  'lit',
  'wheelchair_accessible',
] as const;

export const amenitySchema = z.enum(AMENITY_VALUES);
export type Amenity = z.infer<typeof amenitySchema>;

export const Amenity = {
  COVERED: 'covered',
  CCTV: 'cctv',
  GUARDED: 'guarded',
  EV_CHARGING: 'ev_charging',
  LIT: 'lit',
  WHEELCHAIR_ACCESSIBLE: 'wheelchair_accessible',
} as const satisfies Record<string, Amenity>;

type _MissingFromObject = Exclude<Amenity, (typeof Amenity)[keyof typeof Amenity]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
