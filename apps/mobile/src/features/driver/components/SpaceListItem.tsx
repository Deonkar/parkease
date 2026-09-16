import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpaceSearchItem } from '@parkease/contracts/driver';
import type { DurationType } from '@parkease/contracts/enums';
import {
  colors,
  duration as motionDuration,
  elevation,
  fontSize,
  pressScale,
  radius,
  spacing,
  spring,
  stagger,
} from '@parkease/tokens';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { formatPaise } from '@/lib/money';

import { SurgeBadge } from '../../shared/components/SurgeBadge';
import {
  AMENITY_ICONS,
  AMENITY_LABELS,
  durationSuffix,
  formatDistance,
  formatRatingLabel,
  spaceAccessibilityLabel,
} from '../space-display';

import { SlotPill } from './SlotPill';

const MAX_AMENITY_CHIPS = 2;

interface SpaceListItemProps {
  readonly item: SpaceSearchItem;
  readonly duration: DurationType;
  readonly index: number;
  readonly onPress: (id: string) => void;
}

function SpaceListItemBase({ item, duration, index, onPress }: SpaceListItemProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // Runs as a worklet on the UI thread — a press stays responsive even while
  // the list is fetching its next page on the JS thread.
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Capped so row 40 does not animate in seconds after row 1.
  const entering = reduceMotion
    ? undefined
    : FadeInDown.delay(Math.min(index * stagger.step, stagger.max))
        .duration(motionDuration.base)
        .withInitialValues({ transform: [{ translateY: 12 }] });

  return (
    <Animated.View entering={entering} style={pressStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spaceAccessibilityLabel(item, duration)}
        onPressIn={() => {
          if (!reduceMotion) scale.value = withSpring(pressScale, spring.snappy);
        }}
        onPressOut={() => {
          if (!reduceMotion) scale.value = withSpring(1, spring.snappy);
        }}
        onPress={() => {
          onPress(item.id);
        }}
        style={styles.row}
      >
        <View style={styles.thumb}>
          {item.thumbnail === null ? (
            <MaterialCommunityIcons name="parking" size={26} color={colors.textTertiary} />
          ) : (
            <Image source={{ uri: item.thumbnail }} style={styles.thumbImage} resizeMode="cover" />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.distance}>{formatDistance(item.distanceM)}</Text>
          </View>

          <Text style={styles.address} numberOfLines={1}>
            {item.addressLine}
          </Text>

          <View style={styles.metaRow}>
            {item.rating === null ? (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>New</Text>
              </View>
            ) : (
              <View style={styles.inlineMeta}>
                <MaterialCommunityIcons name="star" size={14} color={colors.warning} />
                <Text style={styles.metaText}>
                  {formatRatingLabel(item.rating, item.reviewCount)}
                </Text>
              </View>
            )}

            {item.amenities.slice(0, MAX_AMENITY_CHIPS).map((amenity) => (
              <View key={amenity} style={styles.inlineMeta}>
                <MaterialCommunityIcons
                  name={AMENITY_ICONS[amenity]}
                  size={14}
                  color={colors.textSecondary}
                />
                <Text style={styles.metaText}>{AMENITY_LABELS[amenity]}</Text>
              </View>
            ))}
          </View>

          <View style={styles.metaRow}>
            <SlotPill icon="car" count={item.availableSlots.car} open={item.isOpenNow} />
            <SlotPill
              icon="motorbike"
              count={item.availableSlots.twoWheeler}
              open={item.isOpenNow}
            />
            {item.isOpenNow ? null : (
              <View style={styles.closedChip}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={13}
                  color={colors.textTertiary}
                />
                <Text style={styles.closedText}>Closed now</Text>
              </View>
            )}
          </View>

          <SurgeBadge badge={item.surgeBadge} multiplier={item.surgeMultiplier} />

          <View style={styles.priceRow}>
            <Text style={styles.price}>
              {formatPaise(item.effectivePricePaise, { alwaysDecimals: true })}
              <Text style={styles.priceUnit}>{durationSuffix(duration).short}</Text>
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const SpaceListItem = memo(SpaceListItemBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.card,
  },
  thumb: {
    width: 72,
    height: 72,
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
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // A parking bay is a commodity: the name is orientation, not the decision.
  // It sits a step below price rather than tied with it.
  title: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  distance: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  address: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
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
  /**
   * "Closed now" wears the same muted chip as an empty `SlotPill`, because it
   * says the same thing: this space is not usable right now.
   *
   * It used to wear `colors.surge` on `colors.surgeSoft`. That was survivable
   * while surge had no chip of its own; now a surging space shows a warm chip
   * one row below, and two identically-coloured chips in one card meaning
   * "expensive" and "shut" is exactly the glance the list cannot afford. The
   * split is by role, not by loudness: warm belongs to the one element that
   * explains the price, neutral to availability.
   *
   * Suppressing one when the other applies would be worse. A closed space still
   * shows its surged price, and removing the badge would leave that number with
   * nothing explaining it.
   *
   * The ink is `textTertiary` (4.94:1 on `mutedSoft`, AA) rather than
   * `colors.muted`, which measures 4.34:1 there and misses — the same trap
   * `errorInk` exists for. Weight 700 keeps it leading its own group.
   */
  closedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.mutedSoft,
  },
  closedText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  // The largest thing on the card. At a red light this is what the eye must
  // land on first, with free-slot status beside it.
  price: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  priceUnit: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
