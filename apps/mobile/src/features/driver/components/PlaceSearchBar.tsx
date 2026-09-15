import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, elevation, fontSize, radius, spacing } from '@parkease/tokens';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PlaceSuggestion } from '@/features/shared/api/geocoding';
import { usePlaceSearch } from '@/features/shared/hooks/usePlaceSearch';

interface PlaceSearchBarProps {
  /** Label for the currently searched place, shown when the input is idle. */
  readonly selectedLabel: string | null;
  readonly onSelect: (place: PlaceSuggestion) => void;
  readonly onClear: () => void;
  readonly placeholder?: string;
}

/**
 * Destination search over Nominatim (ADR-023: no billed Places API). Debounced
 * inside `usePlaceSearch`, which is shared with the owner listing flow.
 */
export function PlaceSearchBar({
  selectedLabel,
  onSelect,
  onClear,
  placeholder = 'Where are you heading?',
}: PlaceSearchBarProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const { data: suggestions, isFetching, isError, error } = usePlaceSearch(query);

  const showSuggestions = focused && query.trim().length >= 3;
  const displayValue = focused ? query : (selectedLabel ?? query);

  return (
    <View style={styles.wrapper}>
      <View style={styles.field}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.textSecondary} />
        <TextInput
          value={displayValue}
          onChangeText={setQuery}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Search for a destination"
          returnKeyType="search"
          style={styles.input}
        />
        {isFetching ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        {displayValue.length > 0 && !isFetching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear destination"
            hitSlop={8}
            onPress={() => {
              setQuery('');
              onClear();
            }}
          >
            <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {showSuggestions ? (
        <View style={styles.dropdown}>
          {isError ? (
            // A failed lookup says so rather than showing an empty list (R-FAIL-01).
            <Text style={styles.dropdownMessage}>
              {error instanceof Error ? error.message : 'Place search failed. Try again.'}
            </Text>
          ) : null}

          {!isError && suggestions !== undefined && suggestions.length === 0 && !isFetching ? (
            <Text style={styles.dropdownMessage}>No places match that search.</Text>
          ) : null}

          {(suggestions ?? []).map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`${place.title}, ${place.subtitle}`}
              onPress={() => {
                setQuery('');
                setFocused(false);
                onSelect(place);
              }}
              style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
            >
              <MaterialCommunityIcons
                name="map-marker-radius"
                size={16}
                color={colors.textSecondary}
              />
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionTitle} numberOfLines={1}>
                  {place.title}
                </Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                  {place.subtitle}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 20,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  dropdown: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.raised,
  },
  dropdownMessage: {
    padding: spacing.md,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionPressed: {
    backgroundColor: colors.surfaceSecondary,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  suggestionSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
});
