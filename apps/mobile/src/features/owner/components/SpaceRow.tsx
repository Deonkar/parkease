import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ApprovalStatus } from '@parkease/contracts/enums';
import type { OwnerDashboard } from '@parkease/contracts/owner';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { APPROVAL_STATUS_DISPLAY } from '@/features/owner/approval-status';

const pct = (bp: number) => `${String(Math.round(bp / 100))}%`;

/**
 * V1 (fix wave 5): every value of `APPROVAL_STATUS_VALUES` gets its own
 * label here — a space awaiting review, with changes requested, or rejected
 * used to fall into the same "Paused · not in search" branch as a space the
 * owner deliberately deactivated, which is not what happened to it. `active`
 * keeps the availability-green Live dot (that colour means "free right now"
 * and nothing else); `inactive` keeps its own paused copy; every other
 * status renders the shared map's label, icon and colour in the same neutral
 * pill shape `inactive` already used, so a status this dashboard doesn't
 * special-case still reads as a real status rather than silently vanishing
 * into "Paused" again.
 *
 * Extracted from `app/(owner)/index.tsx` into `features/owner/components/`
 * (rather than kept inline) because the app/features layer rule is one-way —
 * `features/` may never import from `app/` (`import/no-restricted-paths`) —
 * so a component this file needs to unit-test on its own has to live here to
 * be importable at all.
 */
export function SpaceRow({ space }: { readonly space: OwnerDashboard['spaces'][number] }) {
  const live = space.approvalStatus === ApprovalStatus.ACTIVE;
  const paused = space.approvalStatus === ApprovalStatus.INACTIVE;
  const display = APPROVAL_STATUS_DISPLAY[space.approvalStatus];
  const statusLabel = live
    ? 'live'
    : paused
      ? 'paused, not in search'
      : display.label.toLowerCase();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${space.title}, ${statusLabel}, occupancy ${pct(space.occupancyBp)} today`}
      onPress={() => {
        router.push(`/(owner)/listings/${space.id}`);
      }}
      style={styles.spaceRow}
    >
      <View style={styles.spaceText}>
        <Text style={styles.spaceTitle} numberOfLines={1}>
          {space.title}
        </Text>
        <Text style={styles.muted}>{`Occupancy ${pct(space.occupancyBp)} today`}</Text>
      </View>
      {live ? (
        <View style={styles.pill}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      ) : paused ? (
        <View style={[styles.pill, styles.neutralPill]}>
          <Text style={styles.neutralPillText}>Paused · not in search</Text>
        </View>
      ) : (
        <View style={[styles.pill, styles.neutralPill]}>
          <MaterialCommunityIcons name={display.icon} size={fontSize.sm} color={display.color} />
          <Text style={[styles.neutralPillText, { color: display.color }]}>{display.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  spaceRow: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  spaceText: { flex: 1, gap: spacing.xs },
  spaceTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textSecondary },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.availableVivid,
  },
  liveText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.available },
  neutralPill: {
    backgroundColor: colors.mutedSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  neutralPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
});
