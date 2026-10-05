import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@parkease/tokens';
import { StyleSheet, View } from 'react-native';

import { starsLabel } from '../reviews/review-copy';

interface StarRatingProps {
  /** The server's display string ("4.2") or a review's whole stars. Never computed here. */
  readonly stars: string | number;
  readonly reviewCount?: number;
  readonly size?: number;
}

/**
 * A read-only row of five stars (direction "Five stars"). One labelled image for a screen reader,
 * not five glyphs (R-FE-12). Rounds to the nearest half star for the picture only; the number the
 * star sits beside is the server's.
 */
export function StarRating({ stars, reviewCount, size = 14 }: StarRatingProps) {
  const halves = Math.round(Number(stars) * 2);
  const label = reviewCount === undefined ? starsLabel(stars) : starsLabel(stars, reviewCount);
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name =
          halves >= n * 2 ? 'star' : halves === n * 2 - 1 ? 'star-half-full' : 'star-outline';
        return (
          <MaterialCommunityIcons
            key={n}
            name={name}
            size={size}
            color={name === 'star-outline' ? colors.ratingOff : colors.rating}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 1 },
});
