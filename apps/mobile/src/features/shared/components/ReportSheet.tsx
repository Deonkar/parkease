import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReviewReportReason } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useReportReview } from '../reviews/hooks';

import { BottomSheet } from './BottomSheet';

const REASONS: readonly { value: ReviewReportReason; label: string }[] = [
  { value: 'spam_or_fake', label: 'Spam or fake' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'irrelevant', label: 'Not about this space' },
  { value: 'other', label: 'Something else' },
];

interface ReportSheetProps {
  readonly as: 'driver' | 'owner';
  /** The review being reported, or null when the sheet is closed. */
  readonly reviewId: string | null;
  readonly onDone: () => void;
}

/**
 * Report a review. The copy says what happens — someone at ParkEase reads it, and the review stays
 * up meanwhile — because a report button that silently hides reviews is a censorship button, and
 * one that says nothing reads as broken.
 */
export function ReportSheet({ as, reviewId, onDone }: ReportSheetProps) {
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const report = useReportReview(as);

  const close = () => {
    setReason(null);
    setDetail('');
    report.reset();
    onDone();
  };

  const submit = () => {
    if (reviewId === null || reason === null) return;
    report.mutate(
      { reviewId, body: { reason, ...(detail.trim() === '' ? {} : { detail: detail.trim() }) } },
      { onSuccess: close },
    );
  };

  return (
    <BottomSheet
      visible={reviewId !== null}
      onDismiss={close}
      dismissLabel="Close without reporting"
    >
      <View style={styles.copy}>
        <Text style={styles.title}>Report this review</Text>
        <Text style={styles.body}>
          Someone at ParkEase will read it. The review stays up while they do.
        </Text>
      </View>

      <View accessibilityRole="radiogroup" style={styles.reasons}>
        {REASONS.map((option) => {
          const selected = reason === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                setReason(option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.reason, selected && styles.reasonOn]}
            >
              <MaterialCommunityIcons
                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                size={20}
                color={selected ? colors.primary : colors.textTertiary}
              />
              <Text style={styles.reasonText}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={detail}
        onChangeText={setDetail}
        placeholder="Anything else we should know? (optional)"
        placeholderTextColor={colors.textTertiary}
        maxLength={500}
        multiline
        style={styles.input}
        accessibilityLabel="Details for the report"
      />

      {report.isError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {"That didn't send. Check your connection and try again."}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Send report"
          onPress={submit}
          disabled={reason === null}
          loading={report.isPending}
        />
        <Button label="Cancel" variant="ghost" onPress={close} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  copy: { gap: spacing.xs },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  body: { fontSize: fontSize.sm, color: colors.textSecondary },
  reasons: { gap: spacing.xs },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reasonText: { fontSize: fontSize.base, color: colors.text },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
    textAlignVertical: 'top',
  },
  error: { fontSize: fontSize.sm, color: colors.errorInk },
  actions: { gap: spacing.sm },
});
