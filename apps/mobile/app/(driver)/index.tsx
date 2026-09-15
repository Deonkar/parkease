import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpaceSearchItem } from '@parkease/contracts/driver';
import {
  colors,
  duration as motionDuration,
  elevation,
  fontSize,
  pressScale,
  radius,
  spacing,
  spring,
} from '@parkease/tokens';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  ParkMap,
  type MapViewportState,
} from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CLUSTER_MAX_ZOOM, clusterSpaces, type MapViewport } from '@/features/driver/clustering';
import { FilterSheet } from '@/features/driver/components/FilterSheet';
import { PlaceSearchBar } from '@/features/driver/components/PlaceSearchBar';
import { SpaceListItem } from '@/features/driver/components/SpaceListItem';
import { toMarkerModels } from '@/features/driver/components/SpaceMarker';
import { SpacePreviewCard } from '@/features/driver/components/SpacePreviewCard';
import { useNearbyOrigin } from '@/features/driver/hooks/useNearbyOrigin';
import {
  useSearchFilters,
  type SearchFilters,
  type SearchOrigin,
} from '@/features/driver/hooks/useSearchFilters';
import { useSpaceSearch } from '@/features/driver/hooks/useSpaceSearch';

/**
 * How many all-filtered-out pages to walk through before giving up and showing
 * the empty state. Five pages at the default limit is 100 candidates.
 */
const AUTO_ADVANCE_LIMIT = 5;

/** How far the driver must pan before "Search this area" is offered. */
const PAN_THRESHOLD_M = 400;
const DEFAULT_ZOOM = 14;
const CLUSTER_ZOOM_STEP = 2;
// One past the clustering ceiling, so the final tap actually opens the cluster.
const MAX_ZOOM = CLUSTER_MAX_ZOOM + 1;

type ViewMode = 'map' | 'list';

/** Rough metres between two nearby points. Good enough for a pan threshold. */
function metresBetween(a: SearchOrigin, b: SearchOrigin): number {
  const metresPerDegree = 111_320;
  const dLat = (a.lat - b.lat) * metresPerDegree;
  const dLng = (a.lng - b.lng) * metresPerDegree * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** A viewport to cluster against before the map has reported one. */
function fallbackViewport(origin: SearchOrigin, radiusM: number): MapViewport {
  const metresPerDegree = 111_320;
  const dLat = radiusM / metresPerDegree;
  const dLng = radiusM / (metresPerDegree * Math.cos((origin.lat * Math.PI) / 180));
  return {
    zoom: DEFAULT_ZOOM,
    bounds: {
      west: origin.lng - dLng,
      south: origin.lat - dLat,
      east: origin.lng + dLng,
      north: origin.lat + dLat,
    },
  };
}

export default function DriverDiscoveryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const location = useNearbyOrigin();
  const { filters, activeCount, patch, replace, reset } = useSearchFilters();

  const [view, setView] = useState<ViewMode>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewport, setViewport] = useState<MapViewportState | null>(null);
  const [camera, setCamera] = useState<{ center: SearchOrigin; zoom: number } | null>(null);
  // Ticks on every camera command, so "go here again" survives an unchanged target.
  const [cameraNonce, setCameraNonce] = useState(0);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);

  const origin = location.origin;
  const query = useSpaceSearch(origin, filters);

  // Read straight out of the query cache — never copied into state (R-FE-02).
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);

  // The server paginates candidates and only then drops the ones with no free
  // slot, so a page can arrive empty while more pages remain. FlashList cannot
  // help here — an empty list never reaches onEndReached — so pull the next
  // page directly, or the driver is shown "no spots" with results one page away.
  // Depend on primitives and the stable fetchNextPage, never on `query` itself:
  // TanStack Query returns a fresh object every render, so depending on it runs
  // this effect on every render, and every fetchNextPage causes a render. That
  // is an unbounded loop that wedges the JS thread before the app ever paints.
  //
  // AUTO_ADVANCE_LIMIT bounds it a second way. Advancing is correct when the
  // server hands back a page whose rows were all filtered out, but a server
  // that always reports another page would otherwise walk the whole result set
  // in one go. After the cap the driver gets the empty state and can act.
  const { hasNextPage, isFetchingNextPage, isPending, fetchNextPage } = query;
  const [autoAdvances, setAutoAdvances] = useState(0);

  useEffect(() => {
    setAutoAdvances(0);
  }, [filters, origin]);

  useEffect(() => {
    if (
      items.length === 0 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isPending &&
      autoAdvances < AUTO_ADVANCE_LIMIT
    ) {
      setAutoAdvances((n) => n + 1);
      void fetchNextPage();
    }
  }, [items.length, hasNextPage, isFetchingNextPage, isPending, fetchNextPage, autoAdvances]);

  const points = useMemo(() => {
    if (!origin) return [];
    const currentViewport: MapViewport = viewport ?? fallbackViewport(origin, filters.radiusM);
    return clusterSpaces(items, currentViewport);
  }, [items, viewport, origin, filters.radiusM]);

  const markers = useMemo(
    () => toMarkerModels(points, selectedId, filters.durationType),
    [points, selectedId, filters.durationType],
  );

  const moveCamera = useCallback((center: SearchOrigin, zoom: number) => {
    setCamera({ center, zoom });
    setCameraNonce((n) => n + 1);
  }, []);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const panDistanceM = viewport && origin ? metresBetween(viewport.center, origin) : 0;
  const canSearchArea = panDistanceM > PAN_THRESHOLD_M;

  const handleMarkerPress = useCallback(
    (id: string) => {
      const point = points.find((candidate) => candidate.id === id);
      if (!point) return;

      if (point.kind === 'cluster') {
        // Expand the cluster by easing the camera into it.
        setSelectedId(null);
        moveCamera(
          point.location,
          Math.min((viewport?.zoom ?? DEFAULT_ZOOM) + CLUSTER_ZOOM_STEP, MAX_ZOOM),
        );
        return;
      }
      setSelectedId(point.item.id);
      moveCamera(point.item.location, viewport?.zoom ?? DEFAULT_ZOOM);
    },
    [points, viewport, moveCamera],
  );

  const openSpace = useCallback(
    (id: string) => {
      router.push(`/(shared)/space/${id}`);
    },
    [router],
  );

  const searchThisArea = useCallback(() => {
    if (!viewport) return;
    location.setManualOrigin(viewport.center);
    setPlaceLabel(null);
    setSelectedId(null);
  }, [viewport, location]);

  const recentre = useCallback(() => {
    setSelectedId(null);
    // Snap back to the known origin immediately; re-locating then corrects it.
    if (origin) moveCamera(origin, DEFAULT_ZOOM);
    location.recentre();
  }, [location, origin, moveCamera]);

  const removeFilters = useCallback(() => {
    reset();
    setSelectedId(null);
  }, [reset]);

  const expandSearch = useCallback(() => {
    patch({ radiusM: Math.min(filters.radiusM * 2, 25_000) });
  }, [patch, filters.radiusM]);

  const applyFilters = useCallback(
    (next: SearchFilters) => {
      replace(next);
      setFiltersOpen(false);
      setSelectedId(null);
    },
    [replace],
  );

  // --- Location permission denied: website.md §2.5, verbatim ---
  if (location.status === 'denied' && origin === null) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.searchArea}>
          <PlaceSearchBar
            selectedLabel={placeLabel}
            onSelect={(place) => {
              setPlaceLabel(place.title);
              location.setManualOrigin({ lat: place.lat, lng: place.lng });
            }}
            onClear={() => {
              setPlaceLabel(null);
            }}
          />
        </View>
        <EmptyState
          icon={
            <MaterialCommunityIcons
              name="map-marker-radius"
              size={44}
              color={colors.textTertiary}
            />
          }
          title="Enable Location"
          body="ParkEase needs your location to find parking spots near you."
          actionLabel="Enable in Settings"
          onAction={() => {
            void Linking.openSettings();
          }}
          secondaryActionLabel="Search Manually"
          onSecondaryAction={() => {
            location.requestLocation();
          }}
        />
      </View>
    );
  }

  // --- Waiting on the device, or the first page ---
  if (origin === null || query.isPending) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.searchArea}>
          <PlaceSearchBar
            selectedLabel={placeLabel}
            onSelect={(place) => {
              setPlaceLabel(place.title);
              location.setManualOrigin({ lat: place.lat, lng: place.lng });
            }}
            onClear={() => {
              setPlaceLabel(null);
            }}
          />
        </View>
        <Text style={styles.rationale}>
          {origin === null
            ? 'Finding your location to show parking nearby.'
            : 'Looking for parking near you.'}
        </Text>
        <ListSkeleton count={5} itemHeight={96} />
      </View>
    );
  }

  const body = () => {
    if (query.isError) {
      // Offline copy is website.md §6, verbatim.
      const offline = !isAxiosResponseError(query.error);
      return (
        <ErrorState
          title={offline ? "You're offline." : 'Something went wrong on our end.'}
          body={
            offline
              ? 'Check your connection and try again.'
              : "We're looking into it. Please try again."
          }
          actionLabel="Retry"
          onAction={() => {
            void query.refetch();
          }}
        />
      );
    }

    // `hasNextPage` matters here: the server paginates candidates and only then
    // drops the ones with no free slot, so a page can legitimately arrive empty
    // with more still to come. Showing "No spots found" then would be a lie the
    // driver cannot get past — an empty list never fires onEndReached, so
    // nothing would ever fetch the next page.
    if (items.length === 0 && hasNextPage && autoAdvances < AUTO_ADVANCE_LIMIT) {
      return <ListSkeleton count={5} itemHeight={96} />;
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<MaterialCommunityIcons name="parking" size={44} color={colors.textTertiary} />}
          title="No spots found nearby"
          body="Try expanding your search radius or changing filters."
          actionLabel="Expand Search"
          onAction={expandSearch}
          secondaryActionLabel="Remove Filters"
          onSecondaryAction={removeFilters}
        />
      );
    }

    if (view === 'map') {
      return (
        <View style={styles.mapArea}>
          <ParkMap
            style={styles.map}
            location={camera?.center ?? origin}
            zoom={camera?.zoom ?? DEFAULT_ZOOM}
            cameraNonce={cameraNonce}
            markers={markers}
            showOriginDot
            onMarkerPress={handleMarkerPress}
            onViewportChange={setViewport}
            onMapPress={() => {
              setSelectedId(null);
            }}
          />

          {canSearchArea ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(motionDuration.fast)}
              style={styles.searchAreaButton}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search this area"
                onPress={searchThisArea}
                style={styles.pillButton}
              >
                <MaterialCommunityIcons name="magnify" size={16} color={colors.textInverse} />
                <Text style={styles.pillButtonText}>Search this area</Text>
              </Pressable>
            </Animated.View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recentre on my location"
            onPress={recentre}
            style={styles.recentre}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.primary} />
          </Pressable>

          {selected ? (
            <View style={styles.previewWrap} pointerEvents="box-none">
              <SpacePreviewCard
                item={selected}
                duration={filters.durationType}
                onBook={openSpace}
                onDismiss={() => {
                  setSelectedId(null);
                }}
              />
            </View>
          ) : null}
        </View>
      );
    }

    return (
      <FlashList
        data={items}
        keyExtractor={(item: SpaceSearchItem) => item.id}
        renderItem={({ item, index }: { item: SpaceSearchItem; index: number }) => (
          <SpaceListItem
            item={item}
            index={index}
            duration={filters.durationType}
            onPress={openSpace}
          />
        )}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onRefresh={() => {
          void query.refetch();
        }}
        refreshing={query.isRefetching}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={
          query.isFetchingNextPage ? <ListSkeleton count={2} itemHeight={96} /> : null
        }
      />
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.searchArea}>
        <PlaceSearchBar
          selectedLabel={placeLabel}
          onSelect={(place) => {
            setPlaceLabel(place.title);
            location.setManualOrigin({ lat: place.lat, lng: place.lng });
            setSelectedId(null);
          }}
          onClear={() => {
            setPlaceLabel(null);
          }}
        />

        <View style={styles.quickRow}>
          <QuickChip
            label="Car"
            icon="car"
            active={filters.vehicleType === 'car'}
            onPress={() => {
              patch({ vehicleType: filters.vehicleType === 'car' ? undefined : 'car' });
            }}
          />
          <QuickChip
            label="Bike"
            icon="motorbike"
            active={filters.vehicleType === 'two_wheeler'}
            onPress={() => {
              patch({
                vehicleType: filters.vehicleType === 'two_wheeler' ? undefined : 'two_wheeler',
              });
            }}
          />
          <QuickChip
            label="Under ₹50/hr"
            active={filters.maxPricePaise === 5000}
            onPress={() => {
              patch({ maxPricePaise: filters.maxPricePaise === 5000 ? undefined : 5000 });
            }}
          />
          <QuickChip
            label={activeCount > 0 ? `Filters (${String(activeCount)})` : 'Filters'}
            icon="tune-variant"
            active={activeCount > 0}
            onPress={() => {
              setFiltersOpen(true);
            }}
          />
        </View>

        {view === 'list' ? (
          <Text style={styles.resultSummary}>
            {`${String(items.length)} space${items.length === 1 ? '' : 's'} · sorted by ${filters.sortBy}`}
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>{body()}</View>

      <View style={[styles.toggleBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <View
          accessibilityRole="tablist"
          accessibilityLabel={`View: ${view === 'map' ? 'Map' : 'List'}`}
          style={styles.toggle}
        >
          <ToggleButton
            label="Map"
            icon="map-outline"
            active={view === 'map'}
            onPress={() => {
              setView('map');
            }}
          />
          <ToggleButton
            label="List"
            icon="format-list-bulleted"
            active={view === 'list'}
            onPress={() => {
              setView('list');
              setSelectedId(null);
            }}
          />
        </View>
      </View>

      <FilterSheet
        visible={filtersOpen}
        filters={filters}
        resultCount={items.length}
        onApply={applyFilters}
        onClose={() => {
          setFiltersOpen(false);
        }}
      />
    </View>
  );
}

/** An axios error with a response is a real HTTP status; without one it is transport. */
function isAxiosResponseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as { response?: unknown }).response !== undefined
  );
}

interface QuickChipProps {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}

function QuickChip({ label, active, onPress, icon }: QuickChipProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        onPressIn={() => {
          if (!reduceMotion) scale.value = withSpring(pressScale, spring.snappy);
        }}
        onPressOut={() => {
          if (!reduceMotion) scale.value = withSpring(1, spring.snappy);
        }}
        onPress={onPress}
        style={[styles.quickChip, active && styles.quickChipActive]}
      >
        {icon ? (
          <MaterialCommunityIcons
            name={icon}
            size={14}
            color={active ? colors.textInverse : colors.textSecondary}
          />
        ) : null}
        <Text style={[styles.quickChipText, active && styles.quickChipTextActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

interface ToggleButtonProps {
  readonly label: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly active: boolean;
  readonly onPress: () => void;
}

function ToggleButton({ label, icon, active, onPress }: ToggleButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} view${active ? ', active' : ''}`}
      onPress={onPress}
      style={[styles.toggleButton, active && styles.toggleButtonActive]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={active ? colors.textInverse : colors.textSecondary}
      />
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  searchArea: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickChipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  quickChipTextActive: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  resultSummary: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  rationale: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  body: {
    flex: 1,
  },
  mapArea: {
    flex: 1,
  },
  map: {
    flex: 1,
    height: undefined,
    borderRadius: radius.none,
  },
  searchAreaButton: {
    position: 'absolute',
    // Bottom, not top. The driver this screen is designed for is one-handed and
    // often still in the car; "Search this area" is the most likely action after
    // panning, and at the top of a 812pt screen it sits outside thumb reach
    // while Recentre — the rarer action — already sits comfortably bottom-right.
    bottom: spacing['3xl'],
    alignSelf: 'center',
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    ...elevation.raised,
  },
  pillButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  recentre: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.base,
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  previewWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  listContent: {
    padding: spacing.base,
  },
  separator: {
    height: spacing.md,
  },
  toggleBar: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    borderRadius: radius.sm,
  },
  toggleButtonActive: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.textInverse,
  },
});
