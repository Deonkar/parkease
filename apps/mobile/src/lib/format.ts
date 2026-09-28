const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function toIST(date: Date): Date {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utc + IST_OFFSET_MS);
}

export function formatDateIST(date: Date): string {
  const ist = toIST(date);
  const day = ist.getDate();
  const month = ist.toLocaleString('en-IN', { month: 'short' });
  const year = ist.getFullYear();
  return `${String(day)} ${month} ${String(year)}`;
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * "12 Sep" / "Fri 12 Sep", no year — for a chart axis or a recent-date line
 * where the year is implied. A fixed English table, not `toLocaleString`:
 * that call's "short" month prints "Sept" (4 letters) on this Node/ICU build
 * rather than "Sep" (S-41), and the table is what makes the output
 * deterministic across ICU builds instead of just differently wrong.
 */
export function formatDayMonthIST(date: Date, options?: { weekday?: boolean }): string {
  const ist = toIST(date);
  // `getMonth()`/`getDay()` are always in range (0-11, 0-6), so these index
  // lookups never miss — the fallback only appeases the indexed-access type.
  const month = MONTH_ABBR[ist.getMonth()] ?? '';
  const base = `${String(ist.getDate())} ${month}`;
  if (options?.weekday !== true) return base;
  const weekday = WEEKDAY_ABBR[ist.getDay()] ?? '';
  return `${weekday} ${base}`;
}

export function formatTimeIST(date: Date): string {
  const ist = toIST(date);
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return `${String(h)}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${String(Math.round(meters))} m`;
  }
  const km = meters / 1000;
  return km >= 10 ? `${String(Math.round(km))} km` : `${km.toFixed(1)} km`;
}
