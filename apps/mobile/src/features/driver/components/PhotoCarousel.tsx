import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpacePhoto } from '@parkease/contracts/driver';
import { colors, duration, radius, spacing } from '@parkease/tokens';
import { useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import PagerView from 'react-native-pager-view';

interface PhotoCarouselProps {
  readonly photos: readonly SpacePhoto[];
  readonly height?: number;
}

const DEFAULT_HEIGHT = 240;

/**
 * Photos, with a dot indicator. Falls back to a placeholder rather than
 * collapsing: a detail screen that starts with an address instead of an image
 * reads as broken, and plenty of owners list without photos.
 *
 * The placeholder is an icon from a real icon set, never an emoji.
 */
export function PhotoCarousel({ photos, height = DEFAULT_HEIGHT }: PhotoCarouselProps) {
  const [page, setPage] = useState(0);
  const { width } = useWindowDimensions();

  if (photos.length === 0) {
    return (
      <View
        style={[styles.placeholder, { height }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel="No photos of this space yet"
      >
        <MaterialCommunityIcons name="image-off-outline" size={36} color={colors.muted} />
      </View>
    );
  }

  return (
    <View style={{ height }}>
      <PagerView
        style={StyleSheet.absoluteFill}
        initialPage={0}
        onPageSelected={(event) => {
          setPage(event.nativeEvent.position);
        }}
        accessibilityLabel={`${String(photos.length)} photos of this space`}
      >
        {photos.map((photo, index) => (
          <View key={photo.url} collapsable={false}>
            <Image
              source={{ uri: photo.url }}
              style={{ width, height }}
              resizeMode="cover"
              accessibilityLabel={`Photo ${String(index + 1)} of ${String(photos.length)}`}
            />
          </View>
        ))}
      </PagerView>

      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((photo, index) => (
            <View key={photo.url} style={[styles.dot, index === page && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary,
  },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    opacity: 0.5,
  },
  dotActive: {
    opacity: 1,
    width: 18,
  },
});

export const PHOTO_FADE_MS = duration.base;
