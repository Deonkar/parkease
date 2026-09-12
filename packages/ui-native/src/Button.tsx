import { colors, fontSize, spacing } from '@parkease/tokens';
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
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyle = variantStyles[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
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
        <Text style={[styles.label, variantStyle.label, isDisabled && styles.labelDisabled]}>
          {label}
        </Text>
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
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  labelDisabled: {
    opacity: 0.7,
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
