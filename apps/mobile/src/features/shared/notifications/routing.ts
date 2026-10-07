import { type Role, ROLE_VALUES } from '@parkease/contracts/enums';
import type { NotificationView } from '@parkease/contracts/shared';

import { formatDayMonthIST, formatTimeIST } from '@/lib/format';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP = /^\/\((driver|owner|valet|washer|shared)\)\/[A-Za-z0-9/_-]*$/;

export interface TapTarget {
  readonly href: string;
  /** The role to make active first, when the link belongs to another role the user holds. */
  readonly switchTo: Role | null;
}

/**
 * Where a tapped notification goes, or `null` for "just open the feed".
 *
 * A push payload is data from outside the process (R-VAL-01): a link is accepted only if it is a
 * plain in-app path. A link into a role the user does not hold is refused here as well as at the
 * destination — the destination's API would 403, and a refused screen is a worse landing than the
 * feed. A link into a role the user does hold, but is not acting as, switches the role first.
 * Authorisation is still the destination's; this only chooses where to land.
 */
export function resolveTap(
  deepLink: unknown,
  roles: readonly Role[],
  activeRole: Role | null,
): TapTarget | null {
  if (typeof deepLink !== 'string') return null;
  const match = GROUP.exec(deepLink);
  const group = match?.[1];
  if (group === undefined || deepLink.includes('..') || deepLink.includes('//')) return null;
  if (group === 'shared') return { href: deepLink, switchTo: null };

  const role = ROLE_VALUES.find((r) => r === group);
  if (role === undefined || !roles.includes(role)) return null;
  return { href: deepLink, switchTo: role === activeRole ? null : role };
}

export interface FeedSection {
  readonly label: 'Today' | 'Yesterday' | 'Earlier';
  readonly items: readonly NotificationView[];
}

const istDay = (ms: number): number => Math.floor((ms + IST_OFFSET_MS) / DAY_MS);

/** Newest-first input stays newest-first; sections appear in the order they are met. */
export function groupByDay(items: readonly NotificationView[], now: Date): FeedSection[] {
  const today = istDay(now.getTime());
  const sections: { label: FeedSection['label']; items: NotificationView[] }[] = [];
  for (const item of items) {
    const age = today - istDay(Date.parse(item.createdAt));
    const label = age <= 0 ? 'Today' : age === 1 ? 'Yesterday' : 'Earlier';
    const last = sections.at(-1);
    if (last?.label === label) last.items.push(item);
    else sections.push({ label, items: [item] });
  }
  return sections;
}

export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const age = istDay(now.getTime()) - istDay(then.getTime());
  if (age <= 0) return `${String(Math.floor(minutes / 60))} h ago`;
  return age === 1 ? formatTimeIST(then) : formatDayMonthIST(then);
}

/** The badge's text: nothing at zero, and a cap so it never outgrows its circle. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
