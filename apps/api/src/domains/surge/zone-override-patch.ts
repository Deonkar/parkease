import {
  surgeZoneOverrideInputSchema,
  type SurgeTier,
  type SurgeZoneOverrideInput,
  type SurgeZoneOverridePatch,
} from '@parkease/contracts/admin';

/**
 * A `surge_zone_overrides` row as the database holds it: every amendable column
 * nullable, because null means "defer to the global config" rather than a value.
 */
export type StoredZoneOverride = {
  readonly zoneId: string;
  readonly label: string;
  readonly reason: string;
  readonly enabled: boolean;
  readonly maxMultiplierBp: number | null;
  readonly peakHourModifierBp: number | null;
  readonly weekendModifierBp: number | null;
  readonly eventModifierBp: number | null;
  readonly tiers: SurgeTier[] | null;
  // A type alias, not an interface, so TypeScript grants it the implicit index
  // signature `AuditService` needs to accept it as a `before`/`after` state.
};

/** null in a column is an absent override, never a value the schema should see. */
const orAbsent = <T>(value: T | null): T | undefined => value ?? undefined;

/**
 * Applies an admin's partial amendment to a stored override and re-validates
 * the *whole* result.
 *
 * `surgeZoneOverridePatchSchema` is the input schema `.partial()`-ed, and
 * `.partial()` drops the refinement tying a raised cap to a ladder that reaches
 * it. Validating only the patch would therefore let an operator raise an
 * airport cell to 2.5x in one request and never supply a 2.5x tier — a
 * reachable multiplier the app has no words for, arrived at one field at a
 * time. So the merge, not the patch, is what gets checked.
 *
 * This is admin input being merged with its own stored row. Merging the global
 * config down onto a zone is a different operation and belongs to the worker,
 * which is the only thing that resolves a config for a calculation.
 */
export function applyZoneOverridePatch(
  existing: StoredZoneOverride,
  patch: SurgeZoneOverridePatch,
): SurgeZoneOverrideInput {
  const merged = {
    // Not patchable: an override is identified by its cell. Moving one would be
    // a delete and a create, with two audit rows to match.
    zoneId: existing.zoneId,
    label: patch.label ?? existing.label,
    reason: patch.reason ?? existing.reason,
    enabled: patch.enabled ?? existing.enabled,
    maxMultiplierBp: patch.maxMultiplierBp ?? orAbsent(existing.maxMultiplierBp),
    peakHourModifierBp: patch.peakHourModifierBp ?? orAbsent(existing.peakHourModifierBp),
    weekendModifierBp: patch.weekendModifierBp ?? orAbsent(existing.weekendModifierBp),
    eventModifierBp: patch.eventModifierBp ?? orAbsent(existing.eventModifierBp),
    tiers: patch.tiers ?? orAbsent(existing.tiers),
  };

  return surgeZoneOverrideInputSchema.parse(merged);
}
