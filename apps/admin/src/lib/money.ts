/**
 * Paise in, ₹ out. The only place in apps/admin that divides by 100. Indian digit grouping
 * (₹1,00,000) and two decimals whenever the paise are non-zero (website.md §8).
 */
const whole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInr(paise: number): string {
  return paise % 100 === 0 ? whole.format(paise / 100) : exact.format(paise / 100);
}

/** `2026-10-06T09:02:00Z` → `06 Oct 2026, 2:32 pm` in IST, whatever the operator's laptop says. */
const ist = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export const formatIst = (iso: string): string => ist.format(new Date(iso));
