import type { PeakWindow, SurgeTier } from '@parkease/contracts/admin';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

import { users } from './identity.js';

/** There is one row, and this is its key. Task 10 §10.4. */
export const GLOBAL_SURGE_CONFIG_KEY = 'global';

/**
 * Surge configuration is DB-backed and admin-editable, loaded once per
 * recalculation run. There is no module-level constant that can drift from it,
 * and no rate compiled into `domains/surge` (R-GEN-05).
 *
 * Multipliers are integer basis points, matching `bookings.surge_multiplier_bp`
 * and every other rate this codebase persists. The JSONB columns each parse
 * through a Zod schema on read (R-DB-08); the CHECKs below are the invariants
 * the database is not willing to take the application's word for (R-DB-05).
 */
export const surgeConfig = pgTable(
  'surge_config',
  {
    id: primaryId(),
    key: text('key').notNull().unique(),
    maxMultiplierBp: integer('max_multiplier_bp').notNull(),
    peakHourModifierBp: integer('peak_hour_modifier_bp').notNull(),
    weekendModifierBp: integer('weekend_modifier_bp').notNull(),
    eventModifierBp: integer('event_modifier_bp').notNull(),
    occupancyWindowMinutes: integer('occupancy_window_minutes').notNull(),
    peakWindows: jsonb('peak_windows').$type<PeakWindow[]>().notNull(),
    tiers: jsonb('tiers').$type<SurgeTier[]>().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check('surge_config_max_check', sql`${t.maxMultiplierBp} BETWEEN 10000 AND 50000`),
    check('surge_config_peak_check', sql`${t.peakHourModifierBp} BETWEEN 10000 AND 20000`),
    check('surge_config_weekend_check', sql`${t.weekendModifierBp} BETWEEN 10000 AND 20000`),
    check('surge_config_event_check', sql`${t.eventModifierBp} BETWEEN 10000 AND 20000`),
    check('surge_config_window_check', sql`${t.occupancyWindowMinutes} BETWEEN 5 AND 1440`),
    check(
      'surge_config_tiers_check',
      sql`jsonb_typeof(${t.tiers}) = 'array' AND jsonb_array_length(${t.tiers}) BETWEEN 2 AND 12`,
    ),
    check(
      'surge_config_peak_windows_check',
      sql`jsonb_typeof(${t.peakWindows}) = 'array' AND jsonb_array_length(${t.peakWindows}) <= 24`,
    ),
  ],
);

/**
 * A per-zone amendment to the global config. Nullable columns mean partial
 * overrides: a zone can raise its cap without restating the whole ladder.
 *
 * The override's cap wins even when it exceeds the global cap — an airport cell
 * configured at 2.5x is a deliberate operator decision, and it is what v1's
 * hard-coded `Math.min(x, 2.0)` made impossible while its admin screen
 * advertised it. The application still requires a ladder that reaches any
 * raised cap, so no operator can create a multiplier the app has no words for.
 */
export const surgeZoneOverrides = pgTable(
  'surge_zone_overrides',
  {
    id: primaryId(),
    /** A geohash-6 cell: ~1.22km x 0.61km. See platform/geo/geohash.ts. */
    zoneId: text('zone_id').notNull().unique(),
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    maxMultiplierBp: integer('max_multiplier_bp'),
    peakHourModifierBp: integer('peak_hour_modifier_bp'),
    weekendModifierBp: integer('weekend_modifier_bp'),
    eventModifierBp: integer('event_modifier_bp'),
    tiers: jsonb('tiers').$type<SurgeTier[]>(),
    reason: text('reason').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('surge_zone_overrides_enabled_idx').on(t.enabled),
    index('surge_zone_overrides_updated_by_idx').on(t.updatedBy),
    check(
      'surge_zone_overrides_zone_id_check',
      sql`${t.zoneId} ~ '^[0-9bcdefghjkmnpqrstuvwxyz]{6}$'`,
    ),
    check(
      'surge_zone_overrides_max_check',
      sql`${t.maxMultiplierBp} IS NULL OR ${t.maxMultiplierBp} BETWEEN 10000 AND 50000`,
    ),
    check(
      'surge_zone_overrides_peak_check',
      sql`${t.peakHourModifierBp} IS NULL OR ${t.peakHourModifierBp} BETWEEN 10000 AND 20000`,
    ),
    check(
      'surge_zone_overrides_weekend_check',
      sql`${t.weekendModifierBp} IS NULL OR ${t.weekendModifierBp} BETWEEN 10000 AND 20000`,
    ),
    check(
      'surge_zone_overrides_event_check',
      sql`${t.eventModifierBp} IS NULL OR ${t.eventModifierBp} BETWEEN 10000 AND 20000`,
    ),
    check(
      'surge_zone_overrides_tiers_check',
      sql`${t.tiers} IS NULL OR (jsonb_typeof(${t.tiers}) = 'array' AND jsonb_array_length(${t.tiers}) BETWEEN 2 AND 12)`,
    ),
    check('surge_zone_overrides_reason_check', sql`length(btrim(${t.reason})) > 0`),
  ],
);
