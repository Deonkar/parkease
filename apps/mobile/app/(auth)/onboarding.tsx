import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';

import { markOnboarded } from '@/features/shared/hooks/useHasOnboarded';

const slides = [
  {
    title: 'Find Parking Instantly',
    body: 'Search thousands of private and public parking spots near your destination. Cars and two-wheelers welcome.',
  },
  {
    title: 'Earn From Your Empty Space',
    body: 'Have an unused parking spot? List it on ParkEase and earn passive income — hourly, daily, or monthly.',
  },
  {
    title: 'Valet & Car Wash, On Demand',
    body: "Too busy to park? We'll send a valet. Want a clean car? We'll wash it while you're away.",
  },
] as const;

export default function OnboardingScreen() {
  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const isLast = page === slides.length - 1;

  const handleNext = async () => {
    if (isLast) {
      await markOnboarded();
      router.replace('/(auth)/phone');
    } else {
      pagerRef.current?.setPage(page + 1);
    }
  };

  const handleSkip = async () => {
    await markOnboarded();
    router.replace('/(auth)/phone');
  };

  return (
    <View style={styles.container}>
      {!isLast && (
        <Pressable
          onPress={() => void handleSkip()}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}

      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageSelected={(e) => {
          setPage(e.nativeEvent.position);
        }}
      >
        {slides.map((slide, i) => (
          <View key={i} style={styles.slide}>
            <View style={styles.illustrationPlaceholder}>
              <Text style={styles.illustrationEmoji}>
                {i === 0 ? '\u{1F5FA}' : i === 1 ? '\u{1F3E0}' : '\u{1F697}'}
              </Text>
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </PagerView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === page && styles.dotActive]}
              accessibilityLabel={`Slide ${String(i + 1)} of ${String(slides.length)}`}
            />
          ))}
        </View>
        <Button
          label={isLast ? 'Get Started' : 'Next'}
          onPress={() => void handleNext()}
          accessibilityLabel={isLast ? 'Get Started' : 'Next slide'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  skipButton: {
    position: 'absolute',
    top: 60,
    right: spacing.base,
    zIndex: 1,
    padding: spacing.sm,
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipText: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  illustrationPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: 24,
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  illustrationEmoji: {
    fontSize: 64,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: fontSize.base * 1.5,
  },
  footer: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing.base,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
});
