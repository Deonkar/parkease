import { z } from 'zod';

import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { paiseSchema } from '../primitives/paise.js';

/**
 * A price must be positive, not merely non-negative.
 *
 * `leg()` in `money/ledger-entries.ts` drops zero-amount entries because the
 * ledger's own CHECK is `amount_paise > 0`, so a free service would compose a
 * posting with no rows and fail at accept rather than at the edit that caused
 * it. `wash_services.price_paise > 0` is the database half of the same rule.
 */
const servicePriceSchema = paiseSchema.refine((value) => value > 0, {
  message: 'a service price must be more than zero',
});

/**
 * One row of a partner's menu, as they see it.
 *
 * §13.3: v1 stored one `price` beside a `vehicleType` that could be `car`,
 * `two_wheeler` or `BOTH`. A query for "what does a Premium Wash cost for a
 * bike" against a `BOTH` row needed the caller to know that `BOTH` meant "use
 * this for either", which no caller did — and a partner charging ₹399 for a car
 * and ₹149 for a bike had no way to say so.
 *
 * So the UI row carries two prices and the database carries two rows, keyed
 * `UNIQUE (washer_user_id, service_name, vehicle_type)`. That constraint makes
 * `BOTH` unrepresentable rather than merely discouraged.
 */
export const washServiceSchema = z.object({
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  pricePaise: servicePriceSchema,
  durationMinutes: z.number().int().min(5).max(480),
  isActive: z.boolean(),
});

export type WashService = z.infer<typeof washServiceSchema>;

/** The whole menu, as `GET /washer/services` returns it — ten rows for five services. */
export const washServiceMenuSchema = z.object({
  services: z.array(washServiceSchema),
});

export type WashServiceMenu = z.infer<typeof washServiceMenuSchema>;

/**
 * One service, both vehicle-type prices, upserted as two rows in one
 * transaction. The service name is the path parameter, not a body field, so a
 * partner cannot edit one service by naming another.
 */
export const upsertWashServiceSchema = z.object({
  carPricePaise: servicePriceSchema,
  bikePricePaise: servicePriceSchema,
  durationMinutes: z.number().int().min(5).max(480),
  isActive: z.boolean(),
});

export type UpsertWashService = z.infer<typeof upsertWashServiceSchema>;

export const washServiceNameParamSchema = z.object({ serviceName: carwashServiceNameSchema });
