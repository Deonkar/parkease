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
 * Five tappable stars. Each is its own 48dp button with its own label, so TalkBack users pick a
 * value the way everyone else does, and a 24dp glyph never means a 24dp target (Material).
 */
export function StarInput({ value, onChange, label, size = 36 }: StarInputProps) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            onPress={() => {
              onChange(n);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${label} ${String(n)} out of 5`}
            accessibilityState={{ selected: value === n }}
            hitSlop={4}
            style={styles.target}
          >
            <MaterialCommunityIcons
              name={on ? 'star' : 'star-outline'}
              size={size}
              color={on ? colors.rating : colors.ratingOff}
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
