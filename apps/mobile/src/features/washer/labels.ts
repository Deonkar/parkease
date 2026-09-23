import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';

/**
 * How the closed catalogue reads to a partner — in one place, because the
 * offers card, the active job, the menu and the earnings lines all name a
 * service, and four spellings of "Basic Exterior Wash" is how a partner starts
 * wondering whether they are four different jobs.
 *
 * `Record` over the contract's own union, so adding a service to the catalogue
 * fails typecheck here until it has a name.
 */
export const SERVICE_LABELS: Readonly<Record<CarwashServiceName, string>> = {
  basic_exterior: 'Basic Exterior Wash',
  premium_wash: 'Premium Wash',
  interior_only: 'Interior Only',
  full_detailing: 'Full Detailing',
  quick_wipe: 'Quick Wipe',
};

/** Lower-case on purpose: it always follows other words ("for a bike"). */
export const VEHICLE_LABELS: Readonly<Record<VehicleType, string>> = {
  car: 'car',
  two_wheeler: 'bike',
};
