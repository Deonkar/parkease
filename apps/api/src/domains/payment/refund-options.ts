import type { AdminRefund, AdminRefundOption } from '@parkease/contracts/admin';
import { REFUND_PROCESSING_FEE_PAISE, RefundTier } from '@parkease/contracts/money';
import { type Paise, toPaise } from '@parkease/contracts/primitives';

import { RefundExceedsBalanceError } from './errors.js';

/**
 * The admin refund presets (task 18a), as pure arithmetic over what is left to refund.
 *
 * Shared by the booking detail (which shows the numbers before the admin confirms) and
 * `AdminRefundCommand` (which posts them), so the amount on the button is the amount refunded.
 * Neither produces a price: they divide a balance the ledger already holds (R-ARCH-06).
 */

/**
 * Bookings an admin may refund directly: the ones that are over. A live booking is refunded by
 * cancelling it, and a partial refund first would leave its cancellation refunding the full
 * total again. `expired` never captured money, so it is not here either.
 */
const ADMIN_REFUNDABLE_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'no_show',
  'cancelled',
]);

export const isAdminRefundable = (bookingStatus: string): boolean =>
  ADMIN_REFUNDABLE_STATUSES.has(bookingStatus);

/**
 * Refund reasons whose posting reversed the booking IN FULL (`refundEntries`). After one of
 * these, owner, platform and tax have already given everything back — the ₹10 a `before_start`
 * cancellation keeps was re-recognised as revenue in the same posting — so a proportional refund
 * on top would debit them a second time. Nothing is refundable after them.
 */
const FULL_REVERSAL_REASONS: ReadonlySet<string> = new Set([
  RefundTier.BEFORE_START,
  RefundTier.OWNER_CANCELLED,
]);

/**
 * What can still go back to the driver: the capture less every refund already issued against it.
 *
 * Every refund counts whatever its gateway status — its ledger posting committed the moment it was
 * created, and a `failed` refund is retried, not forgotten. Refunds beyond the capture cannot
 * happen; if they ever do, `toPaise` throws on the negative rather than offering a refund.
 */
export function refundableOf(
  capturedPaise: number,
  refunds: readonly { readonly amountPaise: number; readonly reason: string | null }[],
): Paise {
  if (refunds.some((r) => r.reason !== null && FULL_REVERSAL_REASONS.has(r.reason))) {
    return toPaise(0);
  }
  const refundedPaise = refunds.reduce((sum, r) => sum + r.amountPaise, 0);
  return toPaise(capturedPaise - refundedPaise);
}

const presetAmount = (
  option: Exclude<AdminRefundOption, 'custom'>,
  refundablePaise: Paise,
): Paise =>
  option === 'full_minus_fee'
    ? toPaise(Math.max(0, refundablePaise - REFUND_PROCESSING_FEE_PAISE))
    : toPaise(Math.floor(refundablePaise / 2));

/**
 * The presets an admin can pick right now. `custom` is never listed: the client supplies its
 * amount. A preset worth nothing is dropped rather than offered as a ₹0 button.
 */
export function refundOptions(
  refundablePaise: Paise,
): readonly { option: AdminRefundOption; amountPaise: Paise }[] {
  return (['full_minus_fee', 'half'] as const)
    .map((option) => ({ option, amountPaise: presetAmount(option, refundablePaise) }))
    .filter((o) => o.amountPaise > 0);
}

/**
 * The amount an admin refund will move. A custom amount must be more than zero and no more than
 * what is left; a preset that works out to zero is refused the same way, since posting it would
 * be an empty ledger transaction.
 */
export function resolveAdminRefund(input: AdminRefund, refundablePaise: Paise): Paise {
  const amountPaise =
    input.option === 'custom' ? input.amountPaise : presetAmount(input.option, refundablePaise);
  if (amountPaise <= 0 || amountPaise > refundablePaise) throw new RefundExceedsBalanceError();
  return amountPaise;
}
