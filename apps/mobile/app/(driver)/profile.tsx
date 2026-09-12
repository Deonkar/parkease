import { colors, fontSize, spacing } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';

export default function DriverProfileScreen() {
  const auth = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <Pressable
        onPress={() => {
          router.push('/(shared)/switch-role');
        }}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Switch role"
      >
        <Text style={styles.itemText}>Switch Role</Text>
        <Text style={styles.chevron}>{'›'}</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          router.push('/(shared)/settings');
        }}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <Text style={styles.itemText}>Settings</Text>
        <Text style={styles.chevron}>{'›'}</Text>
      </Pressable>

      <Pressable
        onPress={() => void auth.signOut()}
        style={[styles.item, styles.signOut]}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 100,
    paddingHorizontal: spacing.base,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.base,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  itemText: {
    fontSize: fontSize.base,
    color: colors.text,
  },
  chevron: {
    fontSize: fontSize.xl,
    color: colors.textTertiary,
  },
  signOut: {
    marginTop: spacing['2xl'],
    borderBottomWidth: 0,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: fontSize.base,
    color: colors.error,
    fontWeight: '500',
  },
});
