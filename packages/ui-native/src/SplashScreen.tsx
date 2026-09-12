import { colors, fontSize, spacing } from '@parkease/tokens';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export function SplashScreen() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulseAnim]);

  return (
    <View style={styles.container} accessibilityRole="none" accessibilityLabel="Loading ParkEase">
      <Animated.View style={[styles.logoContainer, { opacity: pulseAnim }]}>
        <Text style={styles.logo}>P</Text>
      </Animated.View>
      <Text style={styles.name}>ParkEase</Text>
      <Text style={styles.tagline}>Find parking.{'\n'}Earn from parking.</Text>
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
  logoContainer: {
    marginBottom: spacing.xl,
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
});
