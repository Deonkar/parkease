import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PendingReview } from '@parkease/contracts/driver';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { warn } from '@/lib/log';

import { usePendingReviews } from '../../shared/reviews/hooks';

/** "Basement Parking · valet · 2 washes": what is still waiting, in one line. */
function whatIsLeft(pending: PendingReview): string {
  const open = pending.targets.filter((t) => !t.reviewed);
  const washes = open.filter((t) => t.targetType === 'washer').length;
  const parts = [
    ...(open.some((t) => t.targetType === 'space') ? [pending.spaceTitle] : []),
    ...(open.some((t) => t.targetType === 'valet') ? ['valet'] : []),
    ...(washes === 0 ? [] : [washes === 1 ? 'wash' : `${String(washes)} washes`]),
  ];
  return parts.join(' · ');
}

/**
 * The driver home's nudge after a stay (task 17b). Quiet by design — one line above the map,
 * dismissible for the session — because nothing on this screen competes with the map (Wayfinder).
 *
 * It renders nothing when there is nothing to rate, and nothing on an error: a failed nudge is not
 * worth an error state on the home screen. The failure is logged at warn instead (R-FAIL-01).
 */
export function ReviewPromptBanner({ onOpen }: { readonly onOpen: (p: PendingReview) => void }) {
  const { data, isError } = usePendingReviews();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isError) warn('reviews.banner: could not load pending reviews; hiding the prompt');
  }, [isError]);

  const first = data?.[0];
  if (dismissed || first === undefined) return null;

  return (
    <View style={styles.banner}>
      <Pressable
        onPress={() => {
          onOpen(first);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Rate your stay: ${whatIsLeft(first)}`}
        style={styles.main}
      >
        <View style={styles.icon}>
          <MaterialCommunityIcons name="star" size={18} color={colors.rating} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Rate your stay</Text>
          <Text style={styles.body} numberOfLines={1}>
            {whatIsLeft(first)}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
      </Pressable>
      <Pressable
        onPress={() => {
          setDismissed(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        style={styles.close}
      >
        <MaterialCommunityIcons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + spacing.sm,
    paddingLeft: spacing.md,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  body: { fontSize: fontSize.xs, color: colors.textSecondary },
  close: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
