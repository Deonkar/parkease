import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

export const surgeConfig = pgTable(
  'surge_config',
  {
    id: primaryId(),
    baseMultiplierBp: integer('base_multiplier_bp').notNull().default(10_000),
    maxMultiplierBp: integer('max_multiplier_bp').notNull().default(30_000),
    demandThreshold: integer('demand_threshold').notNull().default(80),
    ...timestamps,
  },
  (t) => [
    check('surge_config_base_check', sql`${t.baseMultiplierBp} >= 10000`),
    check('surge_config_max_check', sql`${t.maxMultiplierBp} >= ${t.baseMultiplierBp}`),
    check('surge_config_demand_check', sql`${t.demandThreshold} BETWEEN 1 AND 100`),
  ],
);

export const surgeZoneOverrides = pgTable(
  'surge_zone_overrides',
  {
    id: primaryId(),
    zoneId: text('zone_id').notNull(),
    multiplierBp: integer('multiplier_bp').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    reason: text('reason'),
    ...timestamps,
  },
  (t) => [
    index('surge_zone_overrides_zone_id_idx').on(t.zoneId),
    index('surge_zone_overrides_valid_range_idx').on(t.validFrom, t.validUntil),
    check('surge_zone_overrides_multiplier_check', sql`${t.multiplierBp} >= 10000`),
    check('surge_zone_overrides_valid_check', sql`${t.validUntil} > ${t.validFrom}`),
  ],
);
