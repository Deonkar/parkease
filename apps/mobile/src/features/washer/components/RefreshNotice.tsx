import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface RefreshNoticeProps {
  readonly testID: string;
  /** What Retry refreshes, for TalkBack: "Refresh the job". */
  readonly retryLabel: string;
  readonly onRetry: () => void;
}

/**
 * The latest refresh failed, and the screen is still showing the last good
 * answer (ruling T7-I2) — said without taking that answer away.
 *
 * Extracted on its second use (R-ARCH-07): the active job and the service menu
 * say the same thing in the same place, and a partner who learns what the
 * amber band means on one screen should not have to learn it again.
 */
export function RefreshNotice({ testID, retryLabel, onRetry }: RefreshNoticeProps) {
  return (
    <View style={styles.root} accessibilityLiveRegion="polite" testID={testID}>
      <MaterialCommunityIcons name="cloud-off-outline" size={18} color={colors.warning} />
      <Text style={styles.text}>Couldn't refresh. Showing the last update.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        style={styles.action}
      >
        <Text style={styles.actionLabel}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
    backgroundColor: colors.warningLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: { flex: 1, fontSize: fontSize.sm, color: colors.warning },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  actionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
});
