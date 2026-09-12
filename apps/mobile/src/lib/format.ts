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
