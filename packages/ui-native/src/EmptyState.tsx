import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

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

/**
 * Centred when there is room, scrollable when there is not (task 14 M1). A
 * centred `flex: 1` view spills over its siblings at a short height: over a
 * status rail above it, and under a tab bar below it. `flexGrow` lets the
 * content grow past the viewport and scroll instead.
 */
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
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Sized by its content, then grown to fill a bounded parent or shrunk to it
  // (where it scrolls). Not `flex: 1`: inside another scroll view (the
  // profile renders these in its own) a zero flex basis collapses to nothing.
  scroll: { flexGrow: 1, flexShrink: 1 },
  container: {
    flexGrow: 1,
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
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: fontSize.base * lineHeight.normal,
  },
});
