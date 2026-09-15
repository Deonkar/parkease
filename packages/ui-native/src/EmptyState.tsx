import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button.js';

interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  readonly icon?: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /** Optional second CTA, for the states that website.md gives two. */
  readonly secondaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
}

export function EmptyState({
  title,
  body,
  icon,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.illustrationPlaceholder}>
        {icon ?? <Text style={styles.illustrationText}>{'( )'}</Text>}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>
        {actionLabel && onAction ? (
          <Button
            label={actionLabel}
            onPress={onAction}
            variant="primary"
            accessibilityLabel={actionLabel}
          />
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <Button
            label={secondaryActionLabel}
            onPress={onSecondaryAction}
            variant="secondary"
            accessibilityLabel={secondaryActionLabel}
          />
        ) : null}
      </View>
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
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  illustrationPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  illustrationText: {
    fontSize: fontSize['4xl'],
    color: colors.textTertiary,
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
