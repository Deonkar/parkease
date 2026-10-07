import { colors, fontSize, spacing } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/features/shared/components/ScreenHeader';

export default function SettingsScreen() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Settings" />
      <Pressable
        onPress={() => {
          router.push('/(shared)/settings/notifications');
        }}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Notification settings"
      >
        <Text style={styles.text}>Notifications</Text>
        <Text style={styles.chevron}>{'\u203A'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  text: { fontSize: fontSize.base, color: colors.text },
  chevron: { fontSize: fontSize.xl, color: colors.textTertiary },
});
