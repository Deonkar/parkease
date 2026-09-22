import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VerificationBanner } from '../profile-status';

export interface VerificationGateProps {
  readonly banner: VerificationBanner;
  readonly onAction?: () => void;
}

/**
 * The banner a valet sees until their documents clear.
 *
 * It never hides the offers behind it. A valet who can see three jobs and ₹200
 * within reach has a reason to chase their document upload; an empty locked
 * screen gives them nothing to come back for.
 */
export function VerificationGate({ banner, onAction }: VerificationGateProps) {
  const isError = banner.tone === 'error';
  const ink = isError ? colors.errorInk : colors.primaryDark;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.root,
        {
          backgroundColor: isError ? colors.errorLight : colors.primarySoft,
          borderColor: isError ? colors.error : colors.primary,
        },
      ]}
      testID="verification-gate"
    >
      <MaterialCommunityIcons
        name={isError ? 'alert-circle-outline' : 'clock-outline'}
        size={22}
        color={ink}
      />

      <View style={styles.copy}>
        <Text style={[styles.title, { color: ink }]}>{banner.title}</Text>
        <Text style={[styles.body, { color: ink }]}>{banner.body}</Text>

        {banner.action === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={banner.action}
            onPress={onAction}
            hitSlop={8}
            style={styles.action}
          >
            <Text style={[styles.actionLabel, { color: ink }]}>{banner.action}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.xs, lineHeight: fontSize.xs * lineHeight.normal },
  action: { minHeight: 48, justifyContent: 'center' },
  actionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
