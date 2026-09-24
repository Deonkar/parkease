import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useAnnounce } from '@/features/shared/hooks/useAnnounce';

import type { PresenceError } from '../presence';

import { switchColors } from './switch-colors';

export interface OnlineRailProps {
  readonly isOnline: boolean;
  /** A toggle is in flight; the switch waits for the server's answer. */
  readonly busy: boolean;
  readonly onToggle: (next: boolean) => void;
  /**
   * Online: why the last heartbeat failed (the next is already scheduled).
   * Offline: why an automatic resume after a restart did not work.
   */
  readonly problem?: PresenceError | null;
  /** The switch cannot be used, and this says why in words. */
  readonly disabledReason?: string;
}

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

interface Presentation {
  readonly ground: string;
  /** The offline ground is close to the screen's own, so it needs an edge. */
  readonly edge: string;
  readonly ink: string;
  readonly icon: Icon;
  readonly title: string;
  readonly detail: string | null;
}

/**
 * Each failure is named for what it is. "Reconnecting…" over a revoked
 * permission tells the partner to wait for something that will never clear on
 * its own; the words have to point at the thing they can fix.
 */
const ONLINE_PROBLEM: Readonly<
  Record<PresenceError, Pick<Presentation, 'icon' | 'title' | 'detail'>>
> = {
  unreachable: {
    icon: 'signal-off',
    title: 'Reconnecting…',
    detail: 'New offers may not reach you until this clears',
  },
  location_failed: {
    icon: 'crosshairs-question',
    title: 'Location not updating',
    detail: "We can't get a GPS fix here. Offers may not reach you until it returns",
  },
  permission_denied: {
    icon: 'map-marker-off',
    title: 'Location permission is off',
    detail: 'Turn it back on in Settings to keep getting offers',
  },
  not_verified: {
    icon: 'shield-alert-outline',
    title: 'Offers paused: verification needed',
    detail: 'Your documents need approving before you can take new jobs',
  },
  not_registered: {
    icon: 'account-alert-outline',
    title: 'Partner profile not found',
    detail: 'Finish setting up your profile to keep getting offers',
  },
  refused: {
    icon: 'alert-circle-outline',
    title: 'Offers paused: update refused',
    detail: "ParkEase didn't accept your location update. Go offline and back online",
  },
};

/** Offline because an automatic resume failed: what stopped it. */
const RESUME_FAILED: Readonly<Record<PresenceError, string>> = {
  unreachable: "Couldn't reach ParkEase to put you back online",
  location_failed: "Couldn't find your location to put you back online",
  permission_denied: 'Turn on location to go back online',
  not_verified: 'You can go online once your documents are approved',
  not_registered: 'Finish setting up your profile to go online',
  refused: "ParkEase didn't accept going back online. Try switching on again",
};

/**
 * Colour is never the only signal (R-FE-12): each state has its own icon and
 * its own words, so a partner in direct sunlight reads the same status as
 * everyone else.
 */
function present(
  isOnline: boolean,
  busy: boolean,
  problem: PresenceError | null,
  disabledReason: string | undefined,
): Presentation {
  if (!isOnline) {
    return {
      ground: colors.surfaceTertiary,
      edge: colors.border,
      ink: colors.textSecondary,
      icon: 'power-sleep',
      title: busy ? 'Going online…' : 'Offline',
      detail:
        disabledReason ??
        (problem === null ? 'Go online to get wash jobs near you' : RESUME_FAILED[problem]),
    };
  }
  if (busy) {
    return {
      ground: colors.surfaceTertiary,
      edge: colors.border,
      ink: colors.textSecondary,
      icon: 'power-sleep',
      title: 'Going offline…',
      detail: null,
    };
  }
  if (problem !== null) {
    return {
      ground: colors.warningLight,
      edge: colors.warningLight,
      ink: colors.warning,
      ...ONLINE_PROBLEM[problem],
    };
  }
  return {
    ground: colors.availableSoft,
    edge: colors.availableSoft,
    ink: colors.availableInk,
    icon: 'check-circle',
    title: 'Online · taking jobs',
    detail: null,
  };
}

/**
 * The online switch, fixed above the offers and never inside the scroll — a
 * status that scrolls away disappears exactly when the partner stops looking.
 *
 * The green ground is availability green, used for what it means: this partner
 * is available right now.
 */
export function OnlineRail({
  isOnline,
  busy,
  onToggle,
  problem = null,
  disabledReason,
}: OnlineRailProps) {
  const view = present(isOnline, busy, problem, disabledReason);
  const disabled = busy || disabledReason !== undefined;
  // A failing heartbeat is the one thing here a partner must hear about
  // without looking at the screen (H4).
  useAnnounce(problem === null ? null : [view.title, view.detail].filter(Boolean).join('. '));

  return (
    <View
      style={[styles.root, { backgroundColor: view.ground, borderColor: view.edge }]}
      testID="online-rail"
    >
      <MaterialCommunityIcons name={view.icon} size={20} color={view.ink} />

      <View style={styles.copy}>
        <Text style={[styles.title, { color: view.ink }]}>{view.title}</Text>
        {view.detail === null ? null : (
          <Text style={[styles.detail, { color: view.ink }]}>{view.detail}</Text>
        )}
      </View>

      <Switch
        accessibilityRole="switch"
        // A fixed label (H8): the checked state says on or off, and a label
        // that said it too made TalkBack read the value twice.
        accessibilityLabel="Available for jobs"
        // TalkBack on a disabled switch otherwise hears only "disabled".
        accessibilityHint={disabledReason}
        accessibilityState={{ checked: isOnline, disabled, busy }}
        disabled={disabled}
        value={isOnline}
        onValueChange={onToggle}
        // Availability green: "available for jobs" is what green means here.
        {...switchColors(colors.available)}
        testID="online-switch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  detail: { fontSize: fontSize.xs },
});
