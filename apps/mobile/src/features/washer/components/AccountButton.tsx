import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, touchTarget } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

/**
 * The header's way to the partner's Profile (§14.2–§14.7). Profile left the tab
 * bar to keep it at the four tabs of §14.3, so this is how a partner reaches
 * their documents, Switch role, Settings and Sign out.
 *
 * An account icon, not a gear (M13): it opens the profile, and a gear promises
 * Settings. The testID is the old one, because the walkthrough and the Maestro
 * flows select by it.
 */
export function AccountButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      onPress={() => {
        router.push('/(washer)/profile');
      }}
      android_ripple={{ color: colors.surfaceTertiary, borderless: true, radius: spacing.xl }}
      style={styles.root}
      testID="profile-gear"
    >
      <MaterialCommunityIcons
        name="account-circle-outline"
        size={24}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
