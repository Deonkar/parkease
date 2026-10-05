import type { PendingReview } from '@parkease/contracts/driver';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatDayMonthIST } from '@/lib/format';

import { BottomSheet } from '../../shared/components/BottomSheet';
import { StarInput } from '../../shared/components/StarInput';
import { useSubmitReviews } from '../../shared/reviews/hooks';
import {
  appendReason,
  isLowRating,
  LOW_RATING_REASONS,
  MAX_COMMENT,
  outstandingRows,
  rowsFromPending,
  type SheetRow,
} from '../../shared/reviews/sheet-state';

interface RatingSheetProps {
  /** The booking to rate. Rendered only while open, keyed by booking, so rows always start fresh. */
  readonly pending: PendingReview;
  readonly onDone: () => void;
}

/**
 * Rate a finished stay (task 17 §17.11, direction "Five stars"). The first row is the headline —
 * big stars and the comment; the rest are "Also rate" rows with stars only. Each saves on its own:
 * if one fails, the sheet stays open with just the ones that did not save.
 *
 * At 1–2 stars the prompt becomes "What went wrong?" with three reasons an owner can act on. A
 * tapped reason is written into the comment as a sentence the driver can still edit.
 */
export function RatingSheet({ pending, onDone }: RatingSheetProps) {
  const [rows, setRows] = useState<SheetRow[]>(() => rowsFromPending(pending));
  const [failed, setFailed] = useState(0);
  const spaceId = pending.targets.find((t) => t.targetType === 'space')?.targetId;
  const submit = useSubmitReviews(pending.bookingId, spaceId);

  const [headline, ...others] = rows;
  const update = (targetId: string, patch: Partial<SheetRow>) => {
    setRows((current) => current.map((r) => (r.targetId === targetId ? { ...r, ...patch } : r)));
  };

  const send = () => {
    submit.mutate(rows, {
      onSuccess: ({ saved, failed: count }) => {
        if (count === 0) {
          onDone();
          return;
        }
        setFailed(count);
        setRows(outstandingRows(rows, saved));
      },
    });
  };

  const anyRated = rows.some((r) => r.rating !== null);

  return (
    <BottomSheet visible onDismiss={onDone} dismissLabel="Close, rate later">
      {headline === undefined ? null : (
        <>
          <Text style={styles.title} accessibilityRole="header">
            {`How was ${headline.name}?`}
          </Text>
          <StarInput
            value={headline.rating}
            onChange={(rating) => {
              update(headline.targetId, { rating });
            }}
            label={headline.name}
            size={40}
          />
          <View style={styles.scaleWords} importantForAccessibility="no-hide-descendants">
            <Text style={styles.scaleWord}>Poor</Text>
            <Text style={styles.scaleWord}>Great</Text>
          </View>

          {isLowRating(headline.rating) ? (
            <View style={styles.reasons}>
              <Text style={styles.prompt}>What went wrong?</Text>
              <View style={styles.chips}>
                {LOW_RATING_REASONS.map((reason) => {
                  const on = headline.comment.includes(`${reason}.`);
                  return (
                    <Pressable
                      key={reason}
                      onPress={() => {
                        update(headline.targetId, {
                          comment: appendReason(headline.comment, reason),
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Add: ${reason}`}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{reason}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <TextInput
            value={headline.comment}
            onChangeText={(comment) => {
              update(headline.targetId, { comment });
            }}
            placeholder={
              isLowRating(headline.rating)
                ? 'Anything the owner should fix? (optional)'
                : 'Add a comment (optional)'
            }
            placeholderTextColor={colors.textTertiary}
            maxLength={MAX_COMMENT}
            multiline
            style={styles.input}
            accessibilityLabel={`Comment on ${headline.name}`}
          />
          <Text
            style={styles.counter}
          >{`${String([...headline.comment].length)} / ${String(MAX_COMMENT)}`}</Text>
        </>
      )}

      {others.length > 0 ? (
        <View style={styles.others}>
          <Text style={styles.section}>Also rate</Text>
          {others.map((row) => (
            <View key={row.targetId} style={styles.otherRow}>
              <Text style={styles.otherName}>
                {`${row.name} · ${row.targetType === 'valet' ? 'Valet' : 'Car wash'}`}
              </Text>
              <StarInput
                value={row.rating}
                onChange={(rating) => {
                  update(row.targetId, { rating });
                }}
                label={row.name}
                size={28}
              />
            </View>
          ))}
        </View>
      ) : null}

      {failed > 0 ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {failed === 1
            ? "One rating didn't save. The rest did. Try that one again."
            : `${String(failed)} ratings didn't save. The rest did. Try those again.`}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button label="Submit" onPress={send} disabled={!anyRated} loading={submit.isPending} />
        <Button label="Maybe later" variant="ghost" onPress={onDone} />
      </View>
      <Text style={styles.deadline}>
        {`You can rate this booking until ${formatDayMonthIST(new Date(pending.reviewableUntil))}.`}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  scaleWords: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  scaleWord: { fontSize: fontSize.xs, color: colors.textTertiary },
  reasons: { gap: spacing.sm },
  prompt: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: fontSize.sm, color: colors.textSecondary },
  chipTextOn: { color: colors.primary, fontWeight: fontWeight.semibold },
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
  counter: { alignSelf: 'flex-end', fontSize: fontSize.xs, color: colors.textTertiary },
  others: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  otherRow: { gap: spacing.xs },
  otherName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
  error: { fontSize: fontSize.sm, color: colors.errorInk },
  actions: { gap: spacing.sm },
  deadline: { fontSize: fontSize.xs, color: colors.textTertiary, textAlign: 'center' },
});
