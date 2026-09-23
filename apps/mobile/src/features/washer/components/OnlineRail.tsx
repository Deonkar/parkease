import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Switch, Text, View } from 'react-native';

export interface OnlineRailProps {
  readonly isOnline: boolean;
  /** A toggle is in flight; the switch waits for the server's answer. */
  readonly busy: boolean;
  readonly onToggle: (next: boolean) => void;
  /** The last heartbeat did not land; the next one is already scheduled. */
  readonly reconnecting?: boolean;
  /** The switch cannot be used, and this says why in words. */
  readonly disabledReason?: string;
}

interface Presentation {
  readonly ground: string;
  /** The offline ground is close to the screen's own, so it needs an edge. */
  readonly edge: string;
  readonly ink: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly title: string;
  readonly detail: string | null;
}

/**
 * Colour is never the only signal (R-FE-12): each state has its own icon and
 * its own words, so a partner in direct sunlight reads the same status as
 * everyone else.
 */
function present(
  isOnline: boolean,
  reconnecting: boolean,
  disabledReason: string | undefined,
): Presentation {
  if (!isOnline) {
    return {
      ground: colors.surfaceTertiary,
      edge: colors.border,
      ink: colors.textSecondary,
      icon: 'power-sleep',
      title: 'Offline',
      detail: disabledReason ?? 'Go online to get wash jobs near you',
    };
  }
  if (reconnecting) {
    return {
      ground: colors.warningLight,
      edge: colors.warningLight,
      ink: colors.warning,
      icon: 'signal-off',
      title: 'Reconnecting…',
      detail: 'New offers may not reach you until this clears',
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
  reconnecting = false,
  disabledReason,
}: OnlineRailProps) {
  const view = present(isOnline, reconnecting, disabledReason);
  const disabled = busy || disabledReason !== undefined;

  return (
    <View
      style={[styles.root, { backgroundColor: view.ground, borderColor: view.edge }]}
      testID="online-rail"
      // A lost heartbeat is the one thing here a partner must hear about
      // without looking at the screen.
      accessibilityLiveRegion={reconnecting ? 'polite' : 'none'}
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
        accessibilityLabel={`Available for jobs. Currently ${isOnline ? 'online' : 'offline'}.`}
        accessibilityState={{ checked: isOnline, disabled, busy }}
        disabled={disabled}
        value={isOnline}
        onValueChange={onToggle}
        trackColor={{ false: colors.borderStrong, true: colors.available }}
        thumbColor={colors.surface}
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
