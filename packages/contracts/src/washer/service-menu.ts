import { z } from 'zod';

import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { paiseSchema } from '../primitives/paise.js';

/** Minimum service price: ₹10 (1,000 paise). */
export const MIN_SERVICE_PRICE_PAISE = 1_000;

/** Maximum service price: ₹9,999 (999,900 paise). */
export const MAX_SERVICE_PRICE_PAISE = 999_900;

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
 * A service price on writes (UPSERTs). Tightened to the ₹10–₹9,999 range that
 * the mobile app enforces. This schema is used ONLY by `upsertWashServiceSchema`.
 */
const boundedServicePriceSchema = paiseSchema.refine(
  (value) => value >= MIN_SERVICE_PRICE_PAISE && value <= MAX_SERVICE_PRICE_PAISE,
  {
    message: 'a price must be between ₹10 and ₹9,999',
  },
);

/**
 * One row of a stored service, as `GET /washer/services` returns it.
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
 *
 * The read schema is looser (`> 0`) than the write schema (`₹10–₹9,999`) so that
 * reading the menu does not throw on any out-of-range row that might exist.
 * Writes are validated by `upsertWashServiceSchema` with the tighter bounds.
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
 *
 * Prices are bounded to ₹10–₹9,999 by `boundedServicePriceSchema`.
 */
export const upsertWashServiceSchema = z.object({
  carPricePaise: boundedServicePriceSchema,
  bikePricePaise: boundedServicePriceSchema,
  durationMinutes: z.number().int().min(5).max(480),
  isActive: z.boolean(),
});

export type UpsertWashService = z.infer<typeof upsertWashServiceSchema>;

export const washServiceNameParamSchema = z.object({ serviceName: carwashServiceNameSchema });
