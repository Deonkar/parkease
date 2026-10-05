import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, touchTarget } from '@parkease/tokens';
import { Pressable, StyleSheet, View } from 'react-native';

interface StarInputProps {
  readonly value: number | null;
  readonly onChange: (stars: number) => void;
  /** What is being rated, for each star's spoken label: "Rate Ravi K. 4 out of 5". */
  readonly label: string;
  /** Glyph size. The touch target is 48dp whatever this is. */
  readonly size?: number;
}

/**
 * Five tappable stars: a radio group named for what is rated, each star a 48dp radio ("4 stars"),
 * so TalkBack announces one group and the choice, and a 24dp glyph never means a 24dp target.
 */
export function StarInput({ value, onChange, label, size = 36 }: StarInputProps) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={`Rate ${label}`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            onPress={() => {
              onChange(n);
            }}
            accessibilityRole="radio"
            accessibilityLabel={n === 1 ? '1 star' : `${String(n)} stars`}
            accessibilityState={{ checked: value === n }}
            hitSlop={4}
            style={styles.target}
          >
            <MaterialCommunityIcons
              name={on ? 'star' : 'star-outline'}
              size={size}
              // The input's empty outline is the control itself, so it needs 3:1 (WCAG 1.4.11);
              // `ratingOff` is for read-only stars, where the number carries the value.
              color={on ? colors.rating : colors.muted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  target: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
