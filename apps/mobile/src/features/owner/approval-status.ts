import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ApprovalStatus,
  type ApprovalStatus as ApprovalStatusValue,
} from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface ApprovalStatusDisplay {
  readonly label: string;
  /**
   * Text (and icon) tint. Every value here is checked against BOTH surfaces
   * it actually renders on: the listing detail badge's plain `surface`, and
   * the dashboard pill's `colors.mutedSoft` (round 2, fix wave 5) —
   * `mutedSoft` (#F1F5F9) is close to white but not white, and `colors.error`
   * on it measures 4.41:1, under the 4.5:1 AA floor, the same failure
   * `colors.ts` already documents for `error` on `errorLight`. `rejected`
   * uses `errorInk` instead (5.91:1 on `mutedSoft`, 6.47:1 on `surface` —
   * clears both). `warning` clears both surfaces already (5.02:1 on
   * `surface`, 4.58:1 on `mutedSoft`) so `pending_approval` and
   * `changes_requested` are unchanged.
   * `approval-status-contrast.test.ts` is the guard against this regressing.
   */
  readonly color: string;
  readonly icon: IconName;
}

/**
 * One map for every place a space's approval status becomes a label, colour
 * and icon — the listing detail badge, the owner listings card, and the
 * dashboard's space pill (R-ARCH-07: this was two near-identical copies,
 * `STATUS_DISPLAY` in `listings/[id].tsx` and `STATUS_CONFIG` in
 * `ListingCard.tsx`, before this extraction — the dashboard would have been a
 * third). The two only ever disagreed on casing ('Pending Approval' vs
 * 'PENDING APPROVAL'); this keeps the listing detail's Title Case as
 * canonical, and `ListingCard` recovers its all-caps look with
 * `textTransform: 'uppercase'` instead of a differently-worded copy.
 *
 * `Record<ApprovalStatusValue, ...>` makes a status added to the enum and not
 * here a type error rather than a silent "Unknown" badge at runtime —
 * `approval-status.test.ts` carries the runtime companion of that guarantee.
 *
 * Glyphs (`✓`, `◷`, `⊘`, `△`, `✕`) are banned as icons (CLAUDE.md): every
 * entry below names a `MaterialCommunityIcons` icon instead, rendered by the
 * caller.
 */
export const APPROVAL_STATUS_DISPLAY: Readonly<Record<ApprovalStatusValue, ApprovalStatusDisplay>> =
  {
    [ApprovalStatus.ACTIVE]: {
      label: 'Active',
      color: colors.success,
      icon: 'check-circle-outline',
    },
    [ApprovalStatus.PENDING_APPROVAL]: {
      label: 'Pending Approval',
      color: colors.warning,
      icon: 'clock-outline',
    },
    [ApprovalStatus.INACTIVE]: {
      label: 'Inactive',
      color: colors.textTertiary,
      icon: 'cancel',
    },
    [ApprovalStatus.CHANGES_REQUESTED]: {
      label: 'Changes Requested',
      color: colors.warning,
      icon: 'alert-outline',
    },
    [ApprovalStatus.REJECTED]: {
      label: 'Not Approved',
      color: colors.errorInk,
      icon: 'close-circle-outline',
    },
  };
