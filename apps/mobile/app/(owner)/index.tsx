import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, EmptyState } from '@parkease/ui-native';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * The dashboard proper — earnings, occupancy, the active-bookings feed — is
 * task 15. What it carries today is the one thing an owner needs the moment a
 * driver pulls up: the scanner.
 *
 * It sits here rather than waiting for the bookings feed because a QR nobody can
 * scan is decoration, which is precisely what v1 shipped (prd.md §6.1).
 */
export default function OwnerDashboardScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.scanCard}>
        <MaterialCommunityIcons name="qrcode-scan" size={28} color={colors.primary} />
        <Text style={styles.scanTitle}>A driver just arrived?</Text>
        <Text style={styles.scanBody}>
          Scan the code on their phone to check them in. Their booking goes active straight away.
        </Text>
        <Button
          label="Scan booking QR"
          onPress={() => {
            router.push('/(owner)/scan');
          }}
        />
      </View>

      <EmptyState
        title="Your dashboard"
        body="Today's earnings, active bookings, occupancy rate and the monthly summary land here next."
        icon={
          <MaterialCommunityIcons
            name="view-dashboard-outline"
            size={48}
            color={colors.textTertiary}
          />
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: spacing.base,
    gap: spacing.lg,
  },
  scanCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  scanTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  scanBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
    marginBottom: spacing.xs,
  },
});
