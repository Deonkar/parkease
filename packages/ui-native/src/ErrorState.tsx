import { colors, fontSize, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button.js';

interface ErrorStateProps {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function ErrorState({ title, body, actionLabel = 'Retry', onAction }: ErrorStateProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.icon}>!</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          accessibilityLabel={actionLabel}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  icon: {
    fontSize: fontSize['3xl'],
    fontWeight: '700',
    color: colors.error,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.errorLight,
    textAlign: 'center',
    lineHeight: 56,
    marginBottom: spacing.base,
    overflow: 'hidden',
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: fontSize.base * 1.5,
  },
});
