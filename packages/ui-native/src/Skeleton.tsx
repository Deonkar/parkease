import { colors } from '@parkease/tokens';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

interface SkeletonProps {
  readonly width: number | `${number}%`;
  readonly height: number;
  readonly borderRadius?: number;
  readonly style?: ViewStyle;
}

export function Skeleton({ width, height, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      accessibilityRole="none"
      accessibilityLabel="Loading"
      style={[styles.skeleton, { width, height, borderRadius, opacity }, style]}
    />
  );
}

interface ListSkeletonProps {
  readonly count: number;
  readonly itemHeight?: number;
}

export function ListSkeleton({ count, itemHeight = 72 }: ListSkeletonProps) {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.listItem, { minHeight: itemHeight }]}>
          <Skeleton width={48} height={48} borderRadius={24} />
          <View style={styles.listItemContent}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="40%" height={14} style={styles.listItemSub} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.skeleton,
  },
  listContainer: {
    padding: 16,
    gap: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listItemContent: {
    flex: 1,
    gap: 8,
  },
  listItemSub: {
    marginTop: 0,
  },
});
