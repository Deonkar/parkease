import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { classifyFix, describeFixAge, type FixHealth } from '../location/health';

export interface OnlineStatusBarProps {
  readonly isOnline: boolean;
  readonly busy: boolean;
  readonly lastFixAt: number | null;
  readonly granted: boolean;
  readonly now: number;
  readonly onToggle: (next: boolean) => void;
  readonly onFix?: () => void;
}

interface Presentation {
  readonly background: string;
  readonly ink: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly title: string;
  readonly detail: string | null;
  readonly action: string | null;
}

/**
 * Colour is never the only signal (R-FE-12): every state carries an icon and
 * words as well. A valet with a colour-vision deficiency, or a phone in direct
 * sunlight, reads the same status everyone else does.
 */
function present(health: FixHealth, ageLabel: string | null): Presentation {
  switch (health) {
    case 'fresh':
      return {
        background: colors.availableSoft,
        ink: colors.availableInk,
        icon: 'crosshairs-gps',
        title: 'Location sharing',
        detail: ageLabel === null ? null : `Updated ${ageLabel}`,
        action: null,
      };
    case 'stale':
      return {
        background: colors.warningLight,
        ink: colors.warning,
        icon: 'signal-off',
        title: 'Weak GPS signal',
        detail: ageLabel === null ? null : `Last updated ${ageLabel}`,
        action: null,
      };
    case 'lost':
      return {
        background: colors.errorLight,
        ink: colors.errorInk,
        icon: 'map-marker-off',
        title: 'Location not updating',
        // Saying the driver sees it too is not a threat — it explains why this
        // matters, which is what makes a valet act on it rather than dismiss it.
        detail:
          ageLabel === null
            ? 'The driver can see this too.'
            : `Last updated ${ageLabel}. The driver can see this too.`,
        action: 'Fix location',
      };
    case 'permission_revoked':
      return {
        background: colors.errorLight,
        ink: colors.errorInk,
        icon: 'lock-alert',
        title: 'Location permission turned off',
        detail: "You can't take jobs until it's on.",
        action: 'Enable in Settings',
      };
  }
}

/**
 * The fixed rail: online state and fix health, above the scroll and never in it.
 *
 * A banner that scrolls away is not a health indicator — it is a health
 * indicator that disappears at exactly the moment the valet stops looking at
 * the screen, which is when a dead feed does its damage.
 */
export function OnlineStatusBar({
  isOnline,
  busy,
  lastFixAt,
  granted,
  now,
  onToggle,
  onFix,
}: OnlineStatusBarProps) {
  if (!isOnline) {
    return (
      <View style={[styles.root, styles.offline]} testID="online-status-bar">
        <MaterialCommunityIcons name="power-sleep" size={20} color={colors.textSecondary} />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>You are offline</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Go online to receive jobs
          </Text>
        </View>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel="Go online to receive jobs. Currently offline."
          accessibilityState={{ checked: false, disabled: busy }}
          disabled={busy}
          value={false}
          onValueChange={onToggle}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
        />
      </View>
    );
  }

  const health = classifyFix(lastFixAt, now, granted);
  const ageLabel = describeFixAge(lastFixAt, now);
  const view = present(health, ageLabel);

  return (
    // Losing the fix is the one thing on this screen a valet must hear about
    // without looking: direction "Focus" puts the offer card in focus, so a
    // rail that only speaks when focused speaks to nobody. `assertive` on a
    // dead feed, `polite` otherwise — a stale reading is informative, a lost
    // one is the driver watching a pin that stopped moving.
    <View
      style={[styles.root, { backgroundColor: view.background }]}
      testID="online-status-bar"
      accessibilityLiveRegion={health === 'fresh' ? 'none' : 'assertive'}
    >
      <MaterialCommunityIcons name={view.icon} size={20} color={view.ink} />

      <View style={styles.copy}>
        <Text style={[styles.title, { color: view.ink }]} testID="status-title">
          {view.title}
        </Text>
        {view.detail === null ? null : (
          <Text style={[styles.detail, { color: view.ink }]} testID="status-detail">
            {view.detail}
          </Text>
        )}
      </View>

      {view.action === null ? (
        <Switch
          accessibilityRole="switch"
          accessibilityLabel={`Go offline. Currently online, ${view.title.toLowerCase()}.`}
          accessibilityState={{ checked: true, disabled: busy }}
          disabled={busy}
          value
          onValueChange={onToggle}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view.action}
          onPress={onFix}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>{view.action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  offline: { backgroundColor: colors.surface },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  detail: { fontSize: fontSize.xs },
  action: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  actionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
});
