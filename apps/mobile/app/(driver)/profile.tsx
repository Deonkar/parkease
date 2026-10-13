import type { SelfServeRole } from '@parkease/contracts/shared';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { toApiFailure } from '@/features/shared/api/errors';
import { NotificationsRow } from '@/features/shared/notifications/NotificationsRow';

/** The roles a driver can take on from here (S-149), in the words task 21's journeys use. */
const TAKE_ON: readonly { role: SelfServeRole['role']; label: string }[] = [
  { role: 'owner', label: 'List your parking space' },
  { role: 'valet', label: 'Register as a valet' },
  { role: 'washer', label: 'Offer car washes' },
];

export default function DriverProfileScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [joining, setJoining] = useState<SelfServeRole['role'] | null>(null);
  const held = auth.status === 'authenticated' ? auth.roles : [];

  const takeOn = async (role: SelfServeRole['role']) => {
    setJoining(role);
    try {
      await auth.addRole(role);
    } catch (error) {
      Alert.alert("Couldn't set that up", toApiFailure(error).message);
    } finally {
      setJoining(null);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void auth.signOut() },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      <Text style={styles.title}>Profile</Text>

      <NotificationsRow />

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

      {TAKE_ON.filter(({ role }) => !held.includes(role)).map(({ role, label }) => (
        <Pressable
          key={role}
          testID={`take-on-${role}`}
          onPress={() => void takeOn(role)}
          disabled={joining !== null}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy: joining === role, disabled: joining !== null }}
        >
          <Text style={styles.itemText}>{joining === role ? 'Setting up…' : label}</Text>
          <Text style={styles.chevron}>{'›'}</Text>
        </Pressable>
      ))}

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
        onPress={handleSignOut}
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
