import {
  SURGE_BADGE_INTENSITY,
  SURGE_BADGE_LABELS,
  SURGE_METER_SEGMENTS,
  type SurgeBadge as SurgeBadgeTier,
} from '@parkease/contracts/enums';
import { colors, duration, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

interface SurgeBadgeProps {
  readonly badge: SurgeBadgeTier | null;
  /** Displayed, never applied. The client does not compute prices (R-FE-06). */
  readonly multiplier: number;
}

/**
 * The demand tier, as a chip.
 *
 * One hue and one fill treatment across all three tiers; the magnitude is
 * carried by a three-segment meter, not by colour, so the tiers stay
 * distinguishable from *each other* in greyscale and under colour-vision
 * deficiency — which is what R-FE-12 actually asks for. Spending a yellow, an
 * orange and a red on the three tiers reads as one warm smear to a deuteranope,
 * and adds three colours the direction never chose.
 *
 * Only the top tier inverts to a solid fill. It is the one a driver should
 * notice before the price, and it is also the only tier whose meter is full, so
 * the inversion and the meter say the same thing twice rather than two things.
 *
 * Shared rather than driver-owned: the space list, the map preview card and the
 * space detail screen all render it (R-ARCH-07).
 */
export function SurgeBadge({ badge, multiplier }: SurgeBadgeProps) {
  const reduceMotion = useReducedMotion();

  // A zone at 1.0x has no tier, so it gets no chip — not an empty one, and not
  // a "no surge" affordance nobody asked for.
  if (badge === null) return null;

  const solid = SURGE_BADGE_INTENSITY[badge] === SURGE_METER_SEGMENTS;

  return (
    <Animated.View
      accessible
      accessibilityRole="text"
      accessibilityLabel={surgeSpokenLabel(badge, multiplier)}
      entering={reduceMotion ? undefined : FadeIn.duration(duration.fast)}
      style={solid ? CHIP_SOLID : CHIP_SOFT}
    >
      <SurgeMeter badge={badge} solid={solid} />
      {/*
        Sentence case, not all-caps. This is the loudest element on an otherwise
        restrained row, and shouting at a driver about a price rise they did not
        cause is the wrong tone — the badge informs, it does not alarm. The
        multiplier leads so the magnitude reads before the words.
      */}
      <Text numberOfLines={1} style={solid ? LABEL_SOLID : LABEL_SOFT}>
        {formatSurgeMultiplier(multiplier)}x {SURGE_BADGE_LABELS[badge]}
      </Text>
    </Animated.View>
  );
}

/**
 * The multiplier, as words, without overstating it.
 *
 * `toFixed(1)` turns the ladder's own 1.25x tier into "1.3x" — the client
 * claiming a higher price than the server issued, which is the inverse of
 * R-FE-06. Two decimals, with a single trailing zero trimmed, gives 1.25x,
 * 1.5x and 2.0x: exact where it has to be, and still matching `website.md`
 * §2.6's "1.5x" where that is what the number is.
 *
 * The tier ladder is admin-editable (task-10 §10.4), so a two-decimal
 * multiplier is an ordinary configuration, not a hypothetical.
 */
export function formatSurgeMultiplier(multiplier: number): string {
  return multiplier.toFixed(2).replace(/0$/, '');
}

/**
 * "High demand, prices are 1.5 times the usual rate" — the tier and the number,
 * because the meter is decorative to a screen reader and the bare tier name
 * would not say how much more this costs.
 */
export function surgeSpokenLabel(badge: SurgeBadgeTier, multiplier: number): string {
  const label = SURGE_BADGE_LABELS[badge];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}, prices are ${formatSurgeMultiplier(multiplier)} times the usual rate`;
}

/**
 * Three bars, of which `SURGE_BADGE_INTENSITY` are filled. Drawn, never an emoji
 * or a glyph: the lightning bolt this chip used to carry said only "surge",
 * which the words already say, while the meter says *how much*.
 *
 * Unfilled segments are outlined in the same ink rather than tinted. A tint of
 * `colors.surge` over `colors.surgeSoft` cannot clear both thresholds at once —
 * the two ends are only 6.38:1 apart, so any alpha that stays clearly lighter
 * than a filled bar lands under 2.2:1 against the ground and stops being
 * countable. The outline keeps the full 6.38:1, and hollow-versus-solid is a
 * second non-colour cue on top of the count.
 */
export function SurgeMeter({
  badge,
  solid = false,
}: {
  readonly badge: SurgeBadgeTier;
  /** Inverted ink, for the one tier whose chip fills solid. */
  readonly solid?: boolean;
}) {
  const filled = SURGE_BADGE_INTENSITY[badge];
  const fillStyle = solid ? SEGMENT_FILLED_SOLID : SEGMENT_FILLED_SOFT;
  const emptyStyle = solid ? SEGMENT_EMPTY_SOLID : SEGMENT_EMPTY_SOFT;

  return (
    <View testID="surge-meter" style={styles.meter}>
      {SEGMENT_INDEXES.map((index) => (
        <View key={index} style={index < filled ? fillStyle : emptyStyle} />
      ))}
    </View>
  );
}

const SEGMENT_INDEXES = Array.from({ length: SURGE_METER_SEGMENTS }, (_, index) => index);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    // The label may shrink; it may never wrap to a second line in a list row.
    flexShrink: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  chipSoft: { backgroundColor: colors.surgeSoft },
  chipSolid: { backgroundColor: colors.surge },

  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    // Half the smallest spacing step: the bars have to read as one meter, not
    // as three separate marks.
    gap: spacing.xs / 2,
  },
  segment: {
    // Sized off the label's own type so the meter sits on the same line rhythm.
    width: spacing.xs,
    height: fontSize.xs,
    borderRadius: radius.none,
    borderWidth: 1,
  },
  segmentFilledSoft: { backgroundColor: colors.surge, borderColor: colors.surge },
  segmentEmptySoft: { backgroundColor: 'transparent', borderColor: colors.surge },
  segmentFilledSolid: { backgroundColor: colors.textInverse, borderColor: colors.textInverse },
  segmentEmptySolid: { backgroundColor: 'transparent', borderColor: colors.textInverse },

  label: {
    // Shrink-and-ellipsize rather than wrap: a chip that grows to two lines
    // reflows the whole row. `minWidth` is what makes the shrink real once a
    // parent does constrain the chip — at large font scales, mostly.
    flexShrink: 1,
    minWidth: 0,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  labelSoft: { color: colors.surge },
  labelSolid: { color: colors.textInverse },
});

// Composed once at module scope: a fresh style array on every render allocates
// inside a FlashList row, which is the one place it is worth avoiding.
const CHIP_SOFT = [styles.chip, styles.chipSoft];
const CHIP_SOLID = [styles.chip, styles.chipSolid];
const LABEL_SOFT = [styles.label, styles.labelSoft];
const LABEL_SOLID = [styles.label, styles.labelSolid];
const SEGMENT_FILLED_SOFT = [styles.segment, styles.segmentFilledSoft];
const SEGMENT_EMPTY_SOFT = [styles.segment, styles.segmentEmptySoft];
const SEGMENT_FILLED_SOLID = [styles.segment, styles.segmentFilledSolid];
const SEGMENT_EMPTY_SOLID = [styles.segment, styles.segmentEmptySolid];
