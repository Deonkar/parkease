const IST_OFFSET_MINUTES = 330;

/**
 * `lib/format.ts`'s `toIST` combines `getTimezoneOffset()` with a fixed IST
 * shift, so on a host already running in IST the two cancel out and it
 * returns the input unchanged — the "local-zone Date" case the brief calls
 * out. A greeting must read the same hour everywhere the app runs, so this
 * adds the fixed offset directly instead of going through `toIST`.
 */
export function greeting(now = new Date()): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const hour = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Formats a server-computed basis-point ratio. Display of a value, not
 * arithmetic on money (R-FE-06): the ratio is already computed.
 */
export function growthCaption(growthBp: number | null): string | null {
  if (growthBp === null) return null;
  if (growthBp === 0) return 'Same as last month';
  const pct = Math.abs(growthBp) / 100;
  const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${shown}% ${growthBp > 0 ? 'more' : 'less'} than last month`;
}
