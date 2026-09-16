import {
  type SurgeConfig,
  surgeConfigSchema,
  type SurgeTier,
  type ZoneId,
  zoneIdSchema,
} from '@parkease/contracts/admin';
import { GLOBAL_SURGE_CONFIG_KEY, surgeConfig, surgeZoneOverrides } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

/**
 * Raised at job start rather than defaulting silently.
 *
 * Defaulting would mean the platform quietly pricing every zone off a constant
 * compiled into this file — which is v1's third bug, the one where two admin
 * screens wrote to fields the calculator never read.
 */
export class MissingSurgeConfigError extends Error {
  constructor() {
    super(
      `No '${GLOBAL_SURGE_CONFIG_KEY}' row in surge_config. ` +
        'Surge cannot be priced from a configuration that does not exist.',
    );
    this.name = 'MissingSurgeConfigError';
  }
}

export interface ResolvedSurgeConfig {
  readonly global: SurgeConfig;
  readonly byZone: ReadonlyMap<ZoneId, SurgeConfig>;
}

/** The nullable half of a `surge_zone_overrides` row: everything that merges. */
export interface SurgeOverrideRow {
  readonly zoneId: string;
  readonly maxMultiplierBp: number | null;
  readonly peakHourModifierBp: number | null;
  readonly weekendModifierBp: number | null;
  readonly eventModifierBp: number | null;
  readonly tiers: SurgeTier[] | null;
}

/**
 * Global merged with one zone's override. Nullable columns mean partial
 * overrides: a zone can raise its cap without restating the whole ladder.
 *
 * **The override's cap wins even when it exceeds the global cap.** That is the
 * entire point of an override — an airport cell configured at 2.5x is a
 * deliberate operator decision, and it is what v1's hard-coded
 * `Math.min(x, 2.0)` made impossible while its admin screen advertised it.
 * There is no clamp here, deliberately.
 *
 * The merged result parses through `surgeConfigSchema`, which is where a cap no
 * tier can reach is rejected: raising a cap without a ladder that contains it
 * would create a reachable multiplier the app has no badge or copy for.
 * `peakWindows` and `occupancyWindowMinutes` are global-only; a zone amends
 * prices, not the clock the whole platform measures against.
 */
export function mergeZoneConfig(global: SurgeConfig, override: SurgeOverrideRow): SurgeConfig {
  return surgeConfigSchema.parse({
    maxMultiplierBp: override.maxMultiplierBp ?? global.maxMultiplierBp,
    peakHourModifierBp: override.peakHourModifierBp ?? global.peakHourModifierBp,
    weekendModifierBp: override.weekendModifierBp ?? global.weekendModifierBp,
    eventModifierBp: override.eventModifierBp ?? global.eventModifierBp,
    occupancyWindowMinutes: global.occupancyWindowMinutes,
    peakWindows: global.peakWindows,
    tiers: override.tiers ?? global.tiers,
  });
}

/**
 * Read once per recalculation run, so there is no module-level constant that
 * can drift from the database. Changing `surge_config.tiers` changes the next
 * run's output with no restart and no deploy.
 *
 * Every JSONB column parses on read (R-DB-08, R-VAL-01): `tiers` and
 * `peakWindows` are inside `surgeConfigSchema`, so one parse covers both, and
 * Drizzle's `$type<>` claim over the column is treated as a claim rather than a
 * fact.
 */
export async function resolveSurgeConfig(deps: JobDeps): Promise<ResolvedSurgeConfig> {
  const [globalRow] = await deps.db
    .select()
    .from(surgeConfig)
    .where(eq(surgeConfig.key, GLOBAL_SURGE_CONFIG_KEY))
    .limit(1);

  if (globalRow === undefined) throw new MissingSurgeConfigError();

  const global = surgeConfigSchema.parse(globalRow);

  const overrides = await deps.db
    .select()
    .from(surgeZoneOverrides)
    .where(eq(surgeZoneOverrides.enabled, true));

  const byZone = new Map<ZoneId, SurgeConfig>();

  for (const row of overrides) {
    const zone = zoneIdSchema.safeParse(row.zoneId);
    if (!zone.success) {
      logger.warn({ zoneId: row.zoneId }, 'surge zone override has no valid geohash-6 zone id');
      continue;
    }

    try {
      byZone.set(zone.data, mergeZoneConfig(global, row));
    } catch (error) {
      // R-FAIL-01: one unusable override must not stop the platform pricing.
      // The zone falls back to the global config, loudly, and every other zone
      // is priced normally.
      logger.warn(
        { err: error, zoneId: zone.data },
        'surge zone override does not merge into a valid config; using the global config for this zone',
      );
    }
  }

  return { global, byZone };
}
