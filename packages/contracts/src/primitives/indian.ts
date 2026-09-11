import { z } from 'zod';

export const indianPhoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const pincodeSchema = z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const vehicleNumberSchema = z
  .string()
  .regex(/^[A-Z]{2}-\d{1,2}-[A-Z]{1,3}-\d{1,4}$/, 'Use the format KA-01-AB-1234');

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type GeoPoint = z.infer<typeof geoPointSchema>;
