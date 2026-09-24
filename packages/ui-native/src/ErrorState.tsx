import { colors, fontSize, fontWeight, lineHeight, spacing } from '@parkease/tokens';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from './Button.js';

interface ErrorStateProps {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/**
 * Centred when there is room, scrollable when there is not (task 14 M1). A
 * centred `flex: 1` view spills over its siblings at a short height: over a
 * status rail above it, and under a tab bar below it. `flexGrow` lets the
 * content grow past the viewport and scroll instead.
 */
export function ErrorState({ title, body, actionLabel = 'Retry', onAction }: ErrorStateProps) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="alert"
    >
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
  icon: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
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
