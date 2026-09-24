import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VerificationBanner } from '@/features/shared/verification';

export interface VerificationNoticeProps {
  readonly banner: VerificationBanner;
  readonly onAction?: () => void;
}

/**
 * The banner a washer sees until their documents clear (§14.7).
 *
 * It sits above the offers and never replaces them: a partner who can see jobs
 * and money within reach has a reason to finish their upload. The copy comes
 * from `describeWasherVerification`; this only draws it.
 *
 * The same shape as valet's `VerificationGate`, deliberately not imported from
 * it — cross-role imports are a lint failure (R-ARCH-01), and the two may
 * diverge as the roles' document flows do.
 */
export function VerificationNotice({ banner, onAction }: VerificationNoticeProps) {
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
      testID="verification-notice"
    >
      <MaterialCommunityIcons
        name={isError ? 'alert-circle-outline' : 'clock-outline'}
        size={22}
        color={ink}
      />

      <View style={styles.copy}>
        <Text style={[styles.title, { color: ink }]}>{banner.title}</Text>
        <Text style={[styles.body, { color: ink }]}>{banner.body}</Text>

        {banner.action === null || onAction === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={banner.action}
            onPress={onAction}
            hitSlop={spacing.sm}
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
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.xs, lineHeight: fontSize.xs * lineHeight.normal },
  action: { minHeight: touchTarget, justifyContent: 'center' },
  actionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
