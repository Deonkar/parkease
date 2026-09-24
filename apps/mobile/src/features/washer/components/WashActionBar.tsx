import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PrimaryAction } from '../photo-gate';

export interface WashActionBarProps {
  /** From `primaryActionFor(job.availableEvents)`; `null` renders nothing. */
  readonly action: PrimaryAction | null;
  /** From `lockReasonFor` — the words that say why the button is locked. */
  readonly lockReason: string | null;
  readonly pending: boolean;
  readonly onPress: () => void;
}

/**
 * The job's one primary action, full width at the thumb.
 *
 * Locked is disabled-with-a-reason, never enabled-then-rejected: the reason is
 * on screen in words, and the server refuses the same move with a 400 anyway,
 * so this lock is for the partner and that one is the record.
 */
export function WashActionBar({ action, lockReason, pending, onPress }: WashActionBarProps) {
  if (action === null) return null;

  const locked = lockReason !== null;
  const disabled = locked || pending;

  return (
    <View style={styles.root}>
      <View style={styles.clip}>
        <Pressable
          testID="wash-primary-action"
          accessibilityRole="button"
          accessibilityLabel={locked ? `${action.label}, unavailable. ${lockReason}` : action.label}
          accessibilityState={{ disabled, busy: pending }}
          disabled={disabled}
          onPress={onPress}
          android_ripple={{ color: colors.primaryDark }}
          style={[styles.button, locked && styles.buttonLocked]}
        >
          {locked ? (
            <MaterialCommunityIcons name="lock-outline" size={18} color={colors.textSecondary} />
          ) : null}
          <Text style={[styles.label, locked && styles.labelLocked]}>
            {pending ? 'Updating…' : action.label}
          </Text>
        </Pressable>
      </View>
      {locked ? <Text style={styles.reason}>{lockReason}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  // The ripple is clipped by its parent on Android, not by its own radius.
  clip: { borderRadius: radius.md, overflow: 'hidden' },
  button: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
  },
  buttonLocked: { backgroundColor: colors.surfaceTertiary },
  label: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textInverse },
  labelLocked: { color: colors.textSecondary },
  reason: { fontSize: fontSize.xs, color: colors.textTertiary, textAlign: 'center' },
});
