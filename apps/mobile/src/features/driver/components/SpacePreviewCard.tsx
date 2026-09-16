import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpaceSearchItem } from '@parkease/contracts/driver';
import type { DurationType } from '@parkease/contracts/enums';
import { colors, elevation, fontSize, radius, spacing, spring } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatPaise } from '@/lib/money';

import { SurgeBadge } from '../../shared/components/SurgeBadge';
import {
  durationSuffix,
  formatDistance,
  formatRatingLabel,
  spaceAccessibilityLabel,
} from '../space-display';

import { SlotPill } from './SlotPill';

const OFFSCREEN = 320;

interface SpacePreviewCardProps {
  readonly item: SpaceSearchItem;
  readonly duration: DurationType;
  readonly onBook: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Slides up when a marker is tapped, dismissed by tapping the map.
 *
 * Arrives on `spring.bouncy` — a deliberate overshoot, because this is the
 * moment the driver's choice lands — and leaves on `spring.gentle`, which does
 * not overshoot. Both run as worklets on the UI thread.
 */
export function SpacePreviewCard({ item, duration, onBook, onDismiss }: SpacePreviewCardProps) {
  const reduceMotion = useReducedMotion();
  const translateY = useSharedValue(reduceMotion ? 0 : OFFSCREEN);

  useEffect(() => {
    if (reduceMotion) {
      translateY.value = 0;
      return;
    }
    // Re-enters for each newly selected marker, so the card reads as arriving
    // rather than silently swapping its contents.
    translateY.value = OFFSCREEN;
    translateY.value = withSpring(0, spring.bouncy);
  }, [item.id, reduceMotion, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const dismiss = () => {
    if (reduceMotion) {
      onDismiss();
      return;
    }
    // The spring's completion callback fires on the UI thread, so the React
    // state update has to be hopped back to JS explicitly.
    translateY.value = withSpring(OFFSCREEN, spring.gentle, (finished) => {
      'worklet';
      if (finished === true) scheduleOnRN(onDismiss);
    });
  };

  // The tier, not the number. `SurgeBadge` and `SurgeBanner` both gate on the
  // badge, and two independent answers to "is this surging" in one component is
  // how the struck-through base price and the chip end up disagreeing once the
  // ladder becomes admin-editable (task-10 §10.4).
  const surged = item.surgeBadge !== null;

  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      <View
        accessible
        accessibilityLabel={spaceAccessibilityLabel(item, duration)}
        style={styles.header}
      >
        <View style={styles.thumb}>
          {item.thumbnail === null ? (
            <MaterialCommunityIcons name="parking" size={24} color={colors.textTertiary} />
          ) : (
            <Image source={{ uri: item.thumbnail }} style={styles.thumbImage} resizeMode="cover" />
          )}
        </View>

        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.distance}>{formatDistance(item.distanceM)}</Text>
          </View>
          <Text style={styles.address} numberOfLines={1}>
            {item.addressLine}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss preview"
          onPress={dismiss}
          hitSlop={12}
          style={styles.close}
        >
          <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        {item.rating === null ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>New</Text>
          </View>
        ) : (
          <View style={styles.inlineMeta}>
            <MaterialCommunityIcons name="star" size={14} color={colors.warning} />
            <Text style={styles.metaText}>{formatRatingLabel(item.rating, item.reviewCount)}</Text>
          </View>
        )}

        <SurgeBadge badge={item.surgeBadge} multiplier={item.surgeMultiplier} />

        {item.isOpenNow ? null : (
          <View style={styles.inlineMeta}>
            <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textTertiary} />
            <Text style={styles.closedText}>Closed now</Text>
          </View>
        )}
      </View>

      <View style={styles.metaRow}>
        <SlotPill icon="car" count={item.availableSlots.car} open={item.isOpenNow} />
        <SlotPill icon="motorbike" count={item.availableSlots.twoWheeler} open={item.isOpenNow} />
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.price}>
          {formatPaise(item.effectivePricePaise, { alwaysDecimals: true })}
          <Text style={styles.priceUnit}> {durationSuffix(duration).short}</Text>
        </Text>
        {surged ? (
          <Text style={styles.basePrice}>
            {formatPaise(item.basePricePaise, { alwaysDecimals: true })} base
          </Text>
        ) : null}
      </View>

      <Button
        label="Book This Space"
        variant="primary"
        accessibilityLabel={`Book ${item.title}`}
        onPress={() => {
          onBook(item.id);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.sheet,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.text,
  },
  distance: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  address: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inlineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  newBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  newBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  closedText: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  price: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  priceUnit: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  basePrice: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
});
