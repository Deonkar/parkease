import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, touchTarget } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

/**
 * The header gear of §14.2–§14.7. Profile left the tab bar to keep it at the
 * four tabs of §14.3, so this is how a partner reaches their documents,
 * Switch Role, Settings and Sign Out.
 */
export function ProfileGear() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile and settings"
      onPress={() => {
        router.push('/(washer)/profile');
      }}
      android_ripple={{ color: colors.surfaceTertiary, borderless: true, radius: spacing.xl }}
      style={styles.root}
      testID="profile-gear"
    >
      <MaterialCommunityIcons name="cog-outline" size={24} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
