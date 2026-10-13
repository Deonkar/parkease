import type { ValetLocationView } from '@parkease/contracts/valet';

/**
 * How old a valet fix may be before the map says so (§21.3 #9).
 *
 * The valet's handset reports every few seconds while moving. Thirty seconds
 * without one means a tunnel, a basement or a dead phone — and a pin that sits
 * still while saying nothing reads as "the valet has stopped", which is a
 * different and more alarming claim than "we have not heard from them".
 */
export const STALE_FIX_MS = 30_000;

export type FixFreshness =
  | { readonly kind: 'none' }
  | { readonly kind: 'live' }
  | { readonly kind: 'stale'; readonly secondsAgo: number };

export function fixFreshness(fix: ValetLocationView | null, now: number): FixFreshness {
  if (fix === null) return { kind: 'none' };
  const age = now - fix.at;
  if (age <= STALE_FIX_MS) return { kind: 'live' };
  return { kind: 'stale', secondsAgo: Math.floor(age / 1000) };
}

/** "Last seen 45s ago", "Last seen 3 min ago": the stale banner's words. */
export function staleFixLabel(secondsAgo: number): string {
  if (secondsAgo < 60) return `Last seen ${String(secondsAgo)}s ago`;
  return `Last seen ${String(Math.floor(secondsAgo / 60))} min ago`;
}

/**
 * The newer of two fixes. The socket and the polled read both deliver one, and
 * whichever arrives last is not necessarily the more recent — a poll response
 * can land after a fresher socket frame.
 */
export function newerFix(
  a: ValetLocationView | null,
  b: ValetLocationView | null,
): ValetLocationView | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.at > a.at ? b : a;
}
