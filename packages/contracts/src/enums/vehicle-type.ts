import { z } from 'zod';

export const VEHICLE_TYPE_VALUES = ['car', 'two_wheeler'] as const;

export const vehicleTypeSchema = z.enum(VEHICLE_TYPE_VALUES);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const VehicleType = {
  CAR: 'car',
  TWO_WHEELER: 'two_wheeler',
} as const satisfies Record<string, VehicleType>;

type _MissingFromObject = Exclude<VehicleType, (typeof VehicleType)[keyof typeof VehicleType]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
