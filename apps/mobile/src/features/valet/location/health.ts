/**
 * How healthy the valet's position feed is, and how old the last fix is.
 *
 * Pure on purpose, and deliberately not inside `LocationHealthBanner.tsx`: the
 * vitest suite runs under `environment: 'node'`, and anything importing
 * `react-native` there dies in rollup on Flow syntax. Keeping the classification
 * out of the component is what lets the boundary table be tested at all.
 */

/** A fix this new is current. */
export const FIX_FRESH_MS = 15_000;
/** Past this, the fix is not worth presenting as a live position. */
export const FIX_STALE_MS = 60_000;

export type FixHealth = 'fresh' | 'stale' | 'lost' | 'permission_revoked';

/**
 * Revoked permission outranks age: a fresh fix from a sensor the OS has since
 * taken away is not a working feed, and reporting it as `fresh` would tell the
 * valet everything is fine while the driver's map quietly stops moving.
 */
export function classifyFix(lastFixAt: number | null, now: number, granted: boolean): FixHealth {
  if (!granted) return 'permission_revoked';
  if (lastFixAt === null) return 'lost';

  const ageMs = now - lastFixAt;
  if (ageMs <= FIX_FRESH_MS) return 'fresh';
  return ageMs <= FIX_STALE_MS ? 'stale' : 'lost';
}

/**
 * The age of a fix, in the words the driver's tracking screen also uses.
 *
 * Derived from the fix's own timestamp, never from when it arrived. A fix that
 * spent two minutes in the offline queue is two minutes old on both screens.
 */
export function describeFixAge(lastFixAt: number | null, now: number): string | null {
  if (lastFixAt === null) return null;

  const ageMs = Math.max(0, now - lastFixAt);
  if (ageMs < 60_000) return `${String(Math.floor(ageMs / 1000))}s ago`;
  return `${String(Math.floor(ageMs / 60_000))} min ago`;
}
