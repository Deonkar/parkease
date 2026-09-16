import { Inject, Injectable } from '@nestjs/common';
import {
  NO_SURGE_SNAPSHOT,
  surgeConfigSchema,
  type SurgeConfig,
  type SurgeSnapshot,
  type SurgeZoneOverrideInput,
  type SurgeZoneOverridePatch,
} from '@parkease/contracts/admin';
import { GLOBAL_SURGE_CONFIG_KEY, surgeConfig, surgeZoneOverrides } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import { withTransaction, type TxHandle } from '../../platform/db/transaction.js';
import { AuditService } from '../../platform/observability/audit.service.js';

import { MissingSurgeConfigError, ZoneOverrideNotFoundError } from './errors.js';
import { SurgeService } from './surge.service.js';
import { applyZoneOverridePatch, type StoredZoneOverride } from './zone-override-patch.js';

/** Who is asking, for the audit row. The controller supplies it; nothing else can. */
export interface SurgeAdminActor {
  readonly userId: string;
  readonly role: string | null;
  readonly ipAddress: string | null;
}

/** Type aliases, not interfaces: an audit `before`/`after` needs an index signature. */
export type SurgeConfigRecord = SurgeConfig & {
  readonly updatedAt: string;
  readonly updatedBy: string | null;
};

export type ZoneOverrideRecord = StoredZoneOverride & {
  readonly updatedAt: string;
  readonly updatedBy: string | null;
};

/** An override with whatever the worker last priced its cell at. */
export interface ZoneOverrideWithLive extends ZoneOverrideRecord {
  readonly live: SurgeSnapshot;
}

const AUDIT_TARGET_CONFIG = 'surge_config';
const AUDIT_TARGET_ZONE = 'surge_zone_override';

export const SURGE_AUDIT_ACTIONS = {
  configRead: 'admin.surge.config.read',
  configReplace: 'admin.surge.config.replace',
  zonesList: 'admin.surge.zones.list',
  zoneCreate: 'admin.surge.zone.create',
  zoneUpdate: 'admin.surge.zone.update',
} as const;

type ConfigRow = typeof surgeConfig.$inferSelect;
type OverrideRow = typeof surgeZoneOverrides.$inferSelect;

/**
 * JSONB has a declared shape and is parsed on read, never trusted because we
 * wrote it (R-DB-08, R-VAL-01). A hand-run UPDATE against `tiers` is exactly
 * the kind of edit this catches before it prices anything.
 */
function toConfig(row: ConfigRow): SurgeConfig {
  return surgeConfigSchema.parse({
    maxMultiplierBp: row.maxMultiplierBp,
    peakHourModifierBp: row.peakHourModifierBp,
    weekendModifierBp: row.weekendModifierBp,
    eventModifierBp: row.eventModifierBp,
    occupancyWindowMinutes: row.occupancyWindowMinutes,
    peakWindows: row.peakWindows,
    tiers: row.tiers,
  });
}

const toConfigRecord = (row: ConfigRow): SurgeConfigRecord => ({
  ...toConfig(row),
  updatedAt: row.updatedAt.toISOString(),
  updatedBy: row.updatedBy,
});

const toOverrideRecord = (row: OverrideRow): ZoneOverrideRecord => ({
  zoneId: row.zoneId,
  label: row.label,
  reason: row.reason,
  enabled: row.enabled,
  maxMultiplierBp: row.maxMultiplierBp,
  peakHourModifierBp: row.peakHourModifierBp,
  weekendModifierBp: row.weekendModifierBp,
  eventModifierBp: row.eventModifierBp,
  tiers: row.tiers,
  updatedAt: row.updatedAt.toISOString(),
  updatedBy: row.updatedBy,
});

/** Absent means "defer to global", which is a null column, not a missing key. */
const orNull = <T>(value: T | undefined): T | null => value ?? null;

const columnsFor = (input: SurgeZoneOverrideInput) => ({
  zoneId: input.zoneId,
  label: input.label,
  reason: input.reason,
  enabled: input.enabled ?? true,
  maxMultiplierBp: orNull(input.maxMultiplierBp),
  peakHourModifierBp: orNull(input.peakHourModifierBp),
  weekendModifierBp: orNull(input.weekendModifierBp),
  eventModifierBp: orNull(input.eventModifierBp),
  tiers: orNull(input.tiers),
});

/**
 * CRUD over the two surge tables, on behalf of an admin, with an audit row in
 * the same transaction as every effect.
 *
 * Resolving the global config down onto a zone for a calculation is a different
 * job and belongs to the worker, which is its only caller. Nothing here decides
 * a price; it stores the numbers the calculator will later be handed.
 */
@Injectable()
export class SurgeAdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly surge: SurgeService,
  ) {}

  async readConfig(actor: SurgeAdminActor): Promise<SurgeConfigRecord> {
    return withTransaction(this.db, async (tx) => {
      const row = await this.loadConfigRow(tx);
      const record = toConfigRecord(row);

      // A read of the pricing model is attributable too: "who looked at this,
      // and when" is half of any answer to "who changed it" (R-SEC-10).
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: SURGE_AUDIT_ACTIONS.configRead,
        targetType: AUDIT_TARGET_CONFIG,
        targetId: row.id,
        before: null,
        after: null,
        ipAddress: actor.ipAddress,
      });

      return record;
    });
  }

  async replaceConfig(actor: SurgeAdminActor, next: SurgeConfig): Promise<SurgeConfigRecord> {
    return withTransaction(this.db, async (tx) => {
      const existing = await this.loadConfigRow(tx);
      const before = toConfig(existing);

      const [updated] = await tx
        .update(surgeConfig)
        .set({
          maxMultiplierBp: next.maxMultiplierBp,
          peakHourModifierBp: next.peakHourModifierBp,
          weekendModifierBp: next.weekendModifierBp,
          eventModifierBp: next.eventModifierBp,
          occupancyWindowMinutes: next.occupancyWindowMinutes,
          peakWindows: next.peakWindows,
          tiers: next.tiers,
          updatedBy: actor.userId,
        })
        .where(eq(surgeConfig.id, existing.id))
        .returning();

      if (updated === undefined) throw new MissingSurgeConfigError();

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: SURGE_AUDIT_ACTIONS.configReplace,
        targetType: AUDIT_TARGET_CONFIG,
        targetId: updated.id,
        before,
        after: next,
        ipAddress: actor.ipAddress,
      });

      return toConfigRecord(updated);
    });
  }

  /**
   * Every override, each with the multiplier its cell is priced at right now.
   *
   * The live column is one MGET for the whole page, and Redis being down costs
   * that column and nothing else (ADR-010) — an operator has to be able to see
   * and fix a bad override during the incident that took the cache down.
   */
  async listZones(actor: SurgeAdminActor): Promise<ZoneOverrideWithLive[]> {
    const rows = await withTransaction(this.db, async (tx) => {
      const found = await tx.select().from(surgeZoneOverrides).orderBy(surgeZoneOverrides.zoneId);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: SURGE_AUDIT_ACTIONS.zonesList,
        targetType: AUDIT_TARGET_ZONE,
        targetId: null,
        before: null,
        after: null,
        ipAddress: actor.ipAddress,
      });

      return found;
    });

    // Outside the transaction: a Redis round trip inside one holds a Postgres
    // connection open across a network call (R-BE-04).
    const live = await this.surge.multipliersFor(rows.map((row) => row.zoneId));

    return rows.map((row) => ({
      ...toOverrideRecord(row),
      live: live.get(row.zoneId) ?? NO_SURGE_SNAPSHOT,
    }));
  }

  async createZone(
    actor: SurgeAdminActor,
    input: SurgeZoneOverrideInput,
  ): Promise<ZoneOverrideRecord> {
    return withTransaction(this.db, async (tx) => {
      // The unique index on zone_id is what makes a duplicate a 23505 the
      // filter turns into a 409, rather than a read-then-write race (R-DB-05).
      const [created] = await tx.insert(surgeZoneOverrides).values({
        ...columnsFor(input),
        updatedBy: actor.userId,
      }).returning();

      if (created === undefined) throw new ZoneOverrideNotFoundError();
      const record = toOverrideRecord(created);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: SURGE_AUDIT_ACTIONS.zoneCreate,
        targetType: AUDIT_TARGET_ZONE,
        targetId: created.id,
        before: null,
        after: record,
        ipAddress: actor.ipAddress,
      });

      return record;
    });
  }

  async updateZone(
    actor: SurgeAdminActor,
    zoneId: string,
    patch: SurgeZoneOverridePatch,
  ): Promise<ZoneOverrideRecord> {
    return withTransaction(this.db, async (tx) => {
      const [existing] = await tx
        .select()
        .from(surgeZoneOverrides)
        .where(eq(surgeZoneOverrides.zoneId, zoneId));

      if (existing === undefined) throw new ZoneOverrideNotFoundError();

      const before = toOverrideRecord(existing);
      // The merge is validated, not the patch: `.partial()` drops the rule
      // tying a raised cap to a ladder that reaches it, and an operator must
      // not be able to climb past it one field per request.
      const merged = applyZoneOverridePatch(before, patch);

      const [updated] = await tx
        .update(surgeZoneOverrides)
        .set({ ...columnsFor(merged), updatedBy: actor.userId })
        .where(eq(surgeZoneOverrides.id, existing.id))
        .returning();

      if (updated === undefined) throw new ZoneOverrideNotFoundError();
      const after = toOverrideRecord(updated);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: SURGE_AUDIT_ACTIONS.zoneUpdate,
        targetType: AUDIT_TARGET_ZONE,
        targetId: updated.id,
        before,
        after,
        ipAddress: actor.ipAddress,
      });

      return after;
    });
  }

  private async loadConfigRow(tx: TxHandle): Promise<ConfigRow> {
    const [row] = await tx
      .select()
      .from(surgeConfig)
      .where(eq(surgeConfig.key, GLOBAL_SURGE_CONFIG_KEY));

    if (row === undefined) throw new MissingSurgeConfigError();
    return row;
  }
}
