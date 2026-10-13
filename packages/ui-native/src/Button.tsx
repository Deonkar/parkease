import { colors, fontSize, opacity, spacing } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: Variant;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly style?: ViewStyle;
  /**
   * A leading icon, drawn before the label. A node rather than an icon name so
   * the kit takes no icon-font dependency: the caller passes its own glyph, sized
   * and coloured to the variant. Decorative — the label still names the action.
   */
  readonly icon?: ReactNode;
  /** For Maestro and component tests. */
  readonly testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
  icon,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyle = variantStyles[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        variantStyle.container,
        pressed && !isDisabled && variantStyle.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.textInverse : colors.primary}
        />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, variantStyle.label, isDisabled && styles.labelDisabled]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 12,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  disabled: {
    opacity: opacity.dimmed,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  labelDisabled: {
    opacity: opacity.muted,
  },
});

const variantStyles = {
  primary: StyleSheet.create({
    container: {
      backgroundColor: colors.primary,
    },
    pressed: {
      backgroundColor: colors.primaryDark,
    },
    label: {
      color: colors.textInverse,
    },
  }),
  secondary: StyleSheet.create({
    container: {
      backgroundColor: colors.surfaceTertiary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pressed: {
      backgroundColor: colors.border,
    },
    label: {
      color: colors.text,
    },
  }),
  ghost: StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
    },
    pressed: {
      backgroundColor: colors.surfaceTertiary,
    },
    label: {
      color: colors.primary,
    },
  }),
};
