import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReviewReportReason } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { warn } from '@/lib/log';

import { toApiFailure } from '../api/errors';
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
  const [sent, setSent] = useState(false);
  const report = useReportReview(as);

  const close = () => {
    setReason(null);
    setDetail('');
    setSent(false);
    report.reset();
    onDone();
  };

  const submit = () => {
    if (reviewId === null || reason === null) return;
    report.mutate(
      { reviewId, body: { reason, ...(detail.trim() === '' ? {} : { detail: detail.trim() }) } },
      {
        onSuccess: () => {
          setSent(true);
        },
        onError: (error) => {
          const failure = toApiFailure(error);
          warn('reviews.report: did not send', { code: failure.code, traceId: failure.traceId });
        },
      },
    );
  };

  return (
    <BottomSheet
      visible={reviewId !== null}
      onDismiss={close}
      dismissLabel="Close without reporting"
    >
      <View style={styles.copy}>
        <Text style={styles.title} accessibilityRole="header">
          {sent ? 'Report sent' : 'Report this review'}
        </Text>
        <Text style={styles.body}>
          {sent
            ? 'Thanks. Someone at ParkEase will read it. The review stays up while they do.'
            : 'Someone at ParkEase will read it. The review stays up while they do.'}
        </Text>
      </View>

      {sent ? (
        <Button label="Done" onPress={close} />
      ) : (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={styles.reasons}>
            {REASONS.map((option) => {
              const selected = reason === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    setReason(option.value);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
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

          {/* Always mounted: TalkBack misses a live region that appears together with its text. */}
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {report.isError ? toApiFailure(report.error).message : ''}
          </Text>

          <View style={styles.actions}>
            <Button
              label="Send report"
              onPress={submit}
              disabled={reason === null}
              loading={report.isPending}
            />
            <Button label="Cancel" variant="ghost" onPress={close} />
          </View>
        </>
      )}
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
