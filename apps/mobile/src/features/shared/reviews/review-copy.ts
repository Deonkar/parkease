import { formatDayMonthIST } from '@/lib/format';

const DAY_MS = 86_400_000;

/** "2 days ago", "3 weeks ago", then a date. A review's age matters more than its timestamp. */
export function reviewedAgo(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${String(days)} days ago`;
  if (days < 56) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week ago' : `${String(weeks)} weeks ago`;
  }
  return formatDayMonthIST(new Date(iso));
}

/**
 * One phrase for a row of stars, so a screen reader says "4.2 out of 5 stars, 18 reviews" instead
 * of five unlabelled glyphs (R-FE-12). `stars` is the server's display string or a whole rating.
 */
export function starsLabel(stars: string | number, reviewCount?: number): string {
  const base = `${String(stars)} out of 5 stars`;
  if (reviewCount === undefined) return base;
  return `${base}, ${String(reviewCount)} ${reviewCount === 1 ? 'review' : 'reviews'}`;
}
