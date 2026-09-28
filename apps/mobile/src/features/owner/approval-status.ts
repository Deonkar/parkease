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
   * Text (and icon) tint. Every value here clears 4.5:1 against BOTH
   * surfaces it actually renders on: the listing detail badge / listing
   * card's plain `colors.surface`, and the dashboard pill's
   * `colors.mutedSoft` (#F1F5F9 — close to white but not white; `mutedSoft`
   * is where round 2 caught `error` failing at 4.41:1, and `surface` is
   * where round 3 caught `success` failing at 3.30:1 for `active`).
   * `approval-status-contrast.test.ts` asserts every
   * `APPROVAL_STATUS_VALUES` member against both surfaces in one table, so a
   * future colour swap that passes one and fails the other cannot ship
   * unnoticed.
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
      // Not `colors.success` (round 3, fix wave 5): it measured 3.30:1 on
      // `surface` and 3.01:1 on `mutedSoft`, both well under AA, and it was
      // never the right token semantically either — Wayfinder reserves the
      // availability green for "free/live right now" (`colors.ts`), which is
      // exactly what an active space is. `colors.available` is the same
      // token `SpaceRow`'s own Live dot text already uses, and clears both
      // surfaces (5.48:1 / 5.01:1).
      color: colors.available,
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
