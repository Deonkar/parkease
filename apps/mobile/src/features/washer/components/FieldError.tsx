import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

export interface FieldErrorProps {
  readonly testID: string;
  readonly message: string;
}

/**
 * Why a field was refused, directly under that field.
 *
 * Icon and words, never colour alone (R-FE-12), and a polite live region so
 * TalkBack reads it when it appears. Extracted on its second use (R-ARCH-07):
 * the menu's price rows and the registration forms say it the same way.
 */
export function FieldError({ testID, message }: FieldErrorProps) {
  return (
    <View style={styles.root} testID={testID} accessibilityLiveRegion="polite">
      <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.errorInk} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  text: { flex: 1, fontSize: fontSize.xs, color: colors.errorInk },
});
