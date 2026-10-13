import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';

/**
 * How the closed wash catalogue reads, to a partner and to a driver alike.
 *
 * In `shared` because both roles name a service: the partner's offer card and
 * menu, and the driver's "add a wash" picker and wash status. Two spellings of
 * "Basic Exterior Wash" across the two apps is how a driver and a partner end
 * up arguing about whether they agreed on the same job.
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
