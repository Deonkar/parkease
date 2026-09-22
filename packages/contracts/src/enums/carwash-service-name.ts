import { z } from 'zod';

/**
 * The v1 service catalogue, closed.
 *
 * §13.3: a partner sets their own **prices** but cannot invent services. A
 * closed set is what makes `wash_services.service_name` a CHECK constraint
 * rather than free text, and it is what lets the assignment query ask "does this
 * partner offer *this* service for *this* vehicle type" as an equality rather
 * than a fuzzy match. Opening it up later is a migration and a task; starting it
 * open would mean two partners spelling the same wash three ways.
 */
export const CARWASH_SERVICE_NAME_VALUES = [
  'basic_exterior',
  'premium_wash',
  'interior_only',
  'full_detailing',
  'quick_wipe',
] as const;

export const carwashServiceNameSchema = z.enum(CARWASH_SERVICE_NAME_VALUES);
export type CarwashServiceName = z.infer<typeof carwashServiceNameSchema>;

export const CarwashServiceName = {
  BASIC_EXTERIOR: 'basic_exterior',
  PREMIUM_WASH: 'premium_wash',
  INTERIOR_ONLY: 'interior_only',
  FULL_DETAILING: 'full_detailing',
  QUICK_WIPE: 'quick_wipe',
} as const satisfies Record<string, CarwashServiceName>;

type _MissingFromObject = Exclude<
  CarwashServiceName,
  (typeof CarwashServiceName)[keyof typeof CarwashServiceName]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
