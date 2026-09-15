import { useEffect, useState } from 'react';

const TICK_MS = 1000;

export interface Countdown {
  readonly leftMs: number;
  readonly expired: boolean;
  /** True inside the urgency threshold. The tone changes; the meaning does not. */
  readonly urgent: boolean;
  /** `m:ss`, tabular-safe. Empty once expired, so callers render their own copy. */
  readonly label: string;
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Ticks a deadline down to zero.
 *
 * Extracted on the second use, not the first (R-ARCH-07). `PriceHeldTimer`
 * counts a quote's price hold; the slot bar on Review & Pay counts the ten
 * minutes before `booking.expire-unpaid` releases the slot. Different copy,
 * different chrome, and identical behaviour — a deadline, a tick, a threshold
 * and an expiry callback. Two copies of that would have drifted the moment one
 * of them fixed a rounding bug.
 *
 * **The server owns expiry.** `booking.expire-unpaid` runs ten minutes after the
 * booking was created and releases the slot regardless of what this is showing.
 * That is what decides what happens at zero: this reports the hold is gone and
 * hands control back to the screen, it does not decide anything. A client clock
 * that believed itself authoritative would disagree with the server on every
 * device with a skewed clock — and the driver's phone is exactly where that
 * happens.
 */
export function useCountdown(
  deadlineAt: string | undefined,
  options: { readonly urgentMs: number; readonly onExpired?: () => void },
): Countdown | null {
  const deadline = deadlineAt === undefined ? Number.NaN : new Date(deadlineAt).getTime();
  const [leftMs, setLeftMs] = useState(() =>
    Number.isNaN(deadline) ? 0 : Math.max(0, deadline - Date.now()),
  );

  const { onExpired } = options;

  useEffect(() => {
    if (Number.isNaN(deadline)) return;

    // Re-read on mount as well as on tick: a screen restored from the
    // background has not been ticking, and the first frame must not show the
    // time it showed when it was backgrounded.
    setLeftMs(Math.max(0, deadline - Date.now()));

    const id = setInterval(() => {
      const next = Math.max(0, deadline - Date.now());
      setLeftMs(next);
      if (next === 0) {
        clearInterval(id);
        onExpired?.();
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
    };
  }, [deadline, onExpired]);

  if (Number.isNaN(deadline)) return null;

  const expired = leftMs === 0;
  return {
    leftMs,
    expired,
    urgent: !expired && leftMs <= options.urgentMs,
    label: expired ? '' : formatCountdown(leftMs),
  };
}
