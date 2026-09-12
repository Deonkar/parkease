import { Role } from '@parkease/contracts/enums';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';

const roles = [
  {
    role: Role.DRIVER,
    emoji: '\u{1F697}',
    title: "I'm looking for parking",
    subtitle: 'Find and book spots near you',
  },
  {
    role: Role.OWNER,
    emoji: '\u{1F3E0}',
    title: 'I have a parking space',
    subtitle: 'List your space and earn money',
  },
  {
    role: Role.VALET,
    emoji: '\u{1F511}',
    title: 'I want to be a valet',
    subtitle: 'Park cars and earn per trip',
  },
  {
    role: Role.WASHER,
    emoji: '\u{1F9FD}',
    title: 'I offer car wash services',
    subtitle: 'Wash vehicles and grow your business',
  },
] as const;

export default function ChooseRoleScreen() {
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const handleSelect = async (role: Role) => {
    setLoading(true);
    try {
      await auth.switchRole(role);
    } catch {
      Alert.alert('Error', 'Failed to set your role. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + spacing.xl }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.title}>How will you use ParkEase?</Text>
        <Text style={styles.subtitle}>You can switch roles anytime from your profile</Text>
      </View>

      <View style={styles.cards}>
        {roles.map((item) => (
          <Pressable
            key={item.role}
            onPress={() => void handleSelect(item.role)}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.subtitle}`}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
              loading && styles.cardDisabled,
            ]}
          >
            <Text style={styles.emoji}>{item.emoji}</Text>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing['2xl'],
  },
  contentContainer: {
    paddingBottom: spacing['3xl'],
  },
  header: {
    marginBottom: spacing['2xl'],
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: spacing.base,
    minHeight: 48,
  },
  cardPressed: {
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.primary,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  emoji: {
    fontSize: 32,
    width: 48,
    textAlign: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
