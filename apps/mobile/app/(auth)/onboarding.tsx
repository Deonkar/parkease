import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';

const slides = [
  {
    title: 'Find Parking Instantly',
    body: 'Search thousands of private and public parking spots near your destination. Cars and two-wheelers welcome.',
    icon: 'map-marker-radius' as const,
    iconColor: '#4F46E5',
    bgColor: '#EEF2FF',
  },
  {
    title: 'Earn From Your Empty Space',
    body: 'Have an unused parking spot? List it on ParkEase and earn passive income — hourly, daily, or monthly.',
    icon: 'home-city' as const,
    iconColor: '#059669',
    bgColor: '#ECFDF5',
  },
  {
    title: 'Valet & Car Wash, On Demand',
    body: "Too busy to park? We'll send a valet. Want a clean car? We'll wash it while you're away.",
    icon: 'car-connected' as const,
    iconColor: '#D97706',
    bgColor: '#FFFBEB',
  },
] as const;

export default function OnboardingScreen() {
  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const isLast = page === slides.length - 1;

  const handleNext = () => {
    if (isLast) {
      router.replace('/(auth)/phone');
    } else {
      pagerRef.current?.setPage(page + 1);
    }
  };

  const handleSkip = () => {
    router.replace('/(auth)/phone');
  };

  return (
    <View style={styles.container}>
      {!isLast && (
        <Pressable
          onPress={handleSkip}
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
          const newPage = e.nativeEvent.position;
          setPage(newPage);
          const slide = slides[newPage];
          if (slide) {
            AccessibilityInfo.announceForAccessibility(
              `${slide.title}. Page ${String(newPage + 1)} of ${String(slides.length)}`,
            );
          }
        }}
      >
        {slides.map((slide, i) => (
          <View key={i} style={styles.slide}>
            <View style={[styles.illustrationContainer, { backgroundColor: slide.bgColor }]}>
              <MaterialCommunityIcons name={slide.icon} size={72} color={slide.iconColor} />
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
          onPress={handleNext}
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
    top: 52,
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
  illustrationContainer: {
    width: 200,
    height: 200,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing['2xl'],
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
