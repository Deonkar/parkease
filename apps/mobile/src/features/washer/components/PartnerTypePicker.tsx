import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WasherPartnerType } from '@parkease/contracts/washer';
import { colors, elevation, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface PartnerTypePickerProps {
  readonly onPick: (type: WasherPartnerType) => void;
}

interface Choice {
  readonly type: WasherPartnerType;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly title: string;
  readonly body: string;
}

/** §14.2's two choices. Both land in one profile and take the same job flow. */
const CHOICES: readonly Choice[] = [
  {
    type: 'business',
    icon: 'storefront-outline',
    title: 'Car wash business',
    body: 'A registered business with a team',
  },
  {
    type: 'gig',
    icon: 'account-outline',
    title: 'Individual washer',
    body: 'I work on my own',
  },
];

export function PartnerTypePicker({ onPick }: PartnerTypePickerProps) {
  return (
    <View style={styles.root}>
      <Text style={styles.question} accessibilityRole="header">
        I am a…
      </Text>
      {CHOICES.map((choice) => (
        <Pressable
          key={choice.type}
          testID={`pick-${choice.type}`}
          accessibilityRole="button"
          accessibilityLabel={`${choice.title}. ${choice.body}`}
          onPress={() => {
            onPick(choice.type);
          }}
          android_ripple={{ color: colors.surfaceTertiary }}
          style={styles.card}
        >
          <View style={styles.icon}>
            <MaterialCommunityIcons name={choice.icon} size={28} color={colors.primary} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>{choice.title}</Text>
            <Text style={styles.body}>{choice.body}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  question: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: spacing['3xl'] * 2,
    padding: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  icon: {
    width: spacing['3xl'],
    height: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  body: { fontSize: fontSize.sm, color: colors.textTertiary },
});
