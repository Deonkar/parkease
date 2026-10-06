/**
 * An IST calendar date to the instant its day starts: 00:00 IST. The dates are already
 * Zod-validated `YYYY-MM-DD`; the offset is written out rather than read from the server's zone,
 * so a deploy in UTC and a laptop in Bengaluru bucket the same row the same way. A range's `to`
 * is exclusive, so `from` and `to` bound `[istDayStart(from), istDayStart(to))`.
 */
export const istDayStart = (day: string): Date => new Date(`${day}T00:00:00+05:30`);
