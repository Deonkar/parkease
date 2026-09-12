import { Role } from '@parkease/contracts/enums';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { SplashScreen } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';

const roleConfig = {
  [Role.DRIVER]: { emoji: '\u{1F697}', label: 'Driver' },
  [Role.OWNER]: { emoji: '\u{1F3E0}', label: 'Owner' },
  [Role.VALET]: { emoji: '\u{1F511}', label: 'Valet' },
  [Role.WASHER]: { emoji: '\u{1F9FD}', label: 'Washer' },
} as const;

export default function SwitchRoleScreen() {
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  if (auth.status !== 'authenticated') return <SplashScreen />;

  const handleSwitch = async (role: Role) => {
    if (role === auth.activeRole) return;

    setLoading(true);
    try {
      await auth.switchRole(role);
    } catch {
      Alert.alert('Error', 'Failed to switch role. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable
        onPress={() => {
          router.back();
        }}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.backText}>{'←  Switch role'}</Text>
      </Pressable>

      <View style={styles.cards}>
        {auth.roles
          .filter((r): r is Exclude<Role, 'admin'> => r !== Role.ADMIN)
          .map((role) => {
            const config = roleConfig[role];
            const isActive = role === auth.activeRole;

            return (
              <Pressable
                key={role}
                onPress={() => void handleSwitch(role)}
                disabled={loading || isActive}
                accessibilityRole="button"
                accessibilityLabel={`${config.label}${isActive ? ', currently active' : ''}`}
                accessibilityState={{ selected: isActive, disabled: loading || isActive }}
                style={[styles.card, isActive && styles.cardActive]}
              >
                <Text style={styles.emoji}>{config.emoji}</Text>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{config.label}</Text>
                  <Text style={styles.cardSubtitle}>
                    {isActive ? 'Currently active' : 'Tap to switch'}
                  </Text>
                </View>
                {isActive ? <Text style={styles.check}>{'✓'}</Text> : null}
              </Pressable>
            );
          })}
      </View>

      <Pressable
        onPress={() => {
          router.push('/(auth)/choose-role');
        }}
        style={styles.addButton}
        accessibilityRole="button"
        accessibilityLabel="Add another role"
      >
        <Text style={styles.addText}>+ Add another role</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  backButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  backText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  cards: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    gap: spacing.base,
    minHeight: 48,
  },
  cardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSecondary,
  },
  emoji: {
    fontSize: 28,
    width: 40,
    textAlign: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  check: {
    fontSize: fontSize.xl,
    color: colors.primary,
    fontWeight: '700',
  },
  addButton: {
    marginHorizontal: spacing.base,
    marginTop: spacing.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderStyle: 'dashed',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  addText: {
    fontSize: fontSize.base,
    color: colors.primary,
    fontWeight: '500',
  },
});
