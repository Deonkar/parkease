import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenHeaderProps {
  readonly title: string;
  /** Hide the back affordance on a screen there is no going back from. */
  readonly canGoBack?: boolean;
  readonly onBack?: () => void;
  readonly right?: React.ReactNode;
}

/** Material's minimum touch target. */
const MIN_TARGET = 48;

/**
 * A header for screens inside a navigator that renders none.
 *
 * Every navigator in this app sets `headerShown: false`, which means a
 * `<Stack.Screen options={{ title }} />` inside a screen body is inert: no
 * title, no back button, and — the part that actually breaks — no top safe-area
 * padding, so content renders under the status bar and the notch.
 *
 * The back button is guarded on `router.canGoBack()`. A screen reached by
 * `router.replace` has no history, and calling `back()` there crashes.
 */
export function ScreenHeader({ title, canGoBack = true, onBack, right }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const showBack = canGoBack && (onBack !== undefined || router.canGoBack());

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {showBack ? (
        <Pressable
          onPress={() => {
            if (onBack !== undefined) onBack();
            else if (router.canGoBack()) router.back();
          }}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          android_ripple={{ color: colors.surfaceTertiary, borderless: true, radius: 24 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.iconButton} />
      )}

      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>

      <View style={styles.iconButton}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
