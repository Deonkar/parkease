import { colors, fontSize, spacing } from '@parkease/tokens';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container} accessibilityRole="none" accessibilityLabel="Loading ParkEase">
      <Text style={styles.logo}>P</Text>
      <Text style={styles.name}>ParkEase</Text>
      <Text style={styles.tagline}>Find parking.{'\n'}Earn from parking.</Text>
      <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  logo: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.surface,
    backgroundColor: colors.primary,
    width: 80,
    height: 80,
    borderRadius: 20,
    textAlign: 'center',
    lineHeight: 80,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  name: {
    fontSize: fontSize['3xl'],
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  tagline: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: fontSize.base * 1.5,
  },
  spinner: {
    marginTop: spacing['3xl'],
  },
});
