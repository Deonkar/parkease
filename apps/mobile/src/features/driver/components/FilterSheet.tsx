import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SearchSort } from '@parkease/contracts/driver';
import { AMENITY_VALUES, DURATION_TYPE_VALUES } from '@parkease/contracts/enums';
import type { Amenity, DurationType, VehicleType } from '@parkease/contracts/enums';
import { toPaise } from '@parkease/contracts/primitives';
import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

import { DEFAULT_FILTERS, type SearchFilters } from '../hooks/useSearchFilters';
import { AMENITY_ICONS, AMENITY_LABELS } from '../space-display';

/** Price stops in paise, ₹0 to ₹200. Steps instead of a slider — no extra dep. */
const PRICE_STOPS = [0, 1500, 3000, 5000, 7500, 10_000, 15_000, 20_000] as const;

const VEHICLE_OPTIONS: readonly { value: VehicleType | undefined; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'two_wheeler', label: 'Two-Wheeler' },
  { value: undefined, label: 'Any' },
];

const DURATION_LABELS: Record<DurationType, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const RATING_OPTIONS: readonly { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'Any' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
  { value: 4.5, label: '4.5+' },
];

const SORT_OPTIONS: readonly { value: SearchSort; label: string }[] = [
  { value: 'distance', label: 'Distance' },
  { value: 'price', label: 'Price' },
  { value: 'rating', label: 'Rating' },
];

interface ChipProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}

function Chip({ label, selected, onPress, icon }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={14}
          color={selected ? colors.textInverse : colors.textSecondary}
        />
      ) : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

interface FilterSheetProps {
  readonly visible: boolean;
  readonly filters: SearchFilters;
  readonly resultCount: number;
  readonly onApply: (filters: SearchFilters) => void;
  readonly onClose: () => void;
}

export function FilterSheet({ visible, filters, resultCount, onApply, onClose }: FilterSheetProps) {
  // A draft so the sheet can be cancelled without disturbing the live search.
  const [draft, setDraft] = useState<SearchFilters>(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  const patch = (next: Partial<SearchFilters>) => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const toggleAmenity = (amenity: Amenity) => {
    const has = draft.amenities.includes(amenity);
    patch({
      amenities: has ? draft.amenities.filter((a) => a !== amenity) : [...draft.amenities, amenity],
    });
  };

  const minIndex = PRICE_STOPS.findIndex((stop) => stop === (draft.minPricePaise ?? 0));
  const maxStop = draft.maxPricePaise ?? PRICE_STOPS[PRICE_STOPS.length - 1];
  const maxIndex = PRICE_STOPS.findIndex((stop) => stop === maxStop);

  const stepPrice = (which: 'min' | 'max', direction: -1 | 1) => {
    const stops = PRICE_STOPS;
    if (which === 'min') {
      const next = Math.min(Math.max(minIndex + direction, 0), maxIndex);
      const value = stops[next] ?? 0;
      patch({ minPricePaise: value === 0 ? undefined : value });
      return;
    }
    const next = Math.min(Math.max(maxIndex + direction, minIndex), stops.length - 1);
    const value = stops[next] ?? stops[stops.length - 1];
    patch({ maxPricePaise: next === stops.length - 1 ? undefined : value });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              onPress={() => {
                setDraft(DEFAULT_FILTERS);
              }}
              hitSlop={8}
            >
              <Text style={styles.reset}>Reset</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.groupLabel}>Vehicle</Text>
            <View accessibilityRole="radiogroup" style={styles.chipRow}>
              {VEHICLE_OPTIONS.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label}
                  selected={draft.vehicleType === option.value}
                  onPress={() => {
                    patch({ vehicleType: option.value });
                  }}
                />
              ))}
            </View>

            <Text style={styles.groupLabel}>Duration</Text>
            <View accessibilityRole="radiogroup" style={styles.chipRow}>
              {DURATION_TYPE_VALUES.map((duration) => (
                <Chip
                  key={duration}
                  label={DURATION_LABELS[duration]}
                  selected={draft.durationType === duration}
                  onPress={() => {
                    patch({ durationType: duration });
                  }}
                />
              ))}
            </View>

            <Text style={styles.groupLabel}>Price per hour</Text>
            <View style={styles.priceRow}>
              <PriceStepper
                caption="Min"
                value={formatPaise(toPaise(PRICE_STOPS[minIndex] ?? 0))}
                onDecrease={() => {
                  stepPrice('min', -1);
                }}
                onIncrease={() => {
                  stepPrice('min', 1);
                }}
              />
              <PriceStepper
                caption="Max"
                value={
                  draft.maxPricePaise === undefined
                    ? 'Any'
                    : formatPaise(toPaise(draft.maxPricePaise))
                }
                onDecrease={() => {
                  stepPrice('max', -1);
                }}
                onIncrease={() => {
                  stepPrice('max', 1);
                }}
              />
            </View>

            <Text style={styles.groupLabel}>Amenities</Text>
            <View style={styles.chipRow}>
              {AMENITY_VALUES.map((amenity) => (
                <Pressable
                  key={amenity}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: draft.amenities.includes(amenity) }}
                  accessibilityLabel={AMENITY_LABELS[amenity]}
                  onPress={() => {
                    toggleAmenity(amenity);
                  }}
                  style={[styles.chip, draft.amenities.includes(amenity) && styles.chipSelected]}
                >
                  <MaterialCommunityIcons
                    name={AMENITY_ICONS[amenity]}
                    size={14}
                    color={
                      draft.amenities.includes(amenity) ? colors.textInverse : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.chipText,
                      draft.amenities.includes(amenity) && styles.chipTextSelected,
                    ]}
                  >
                    {AMENITY_LABELS[amenity]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.groupLabel}>Minimum rating</Text>
            <View accessibilityRole="radiogroup" style={styles.chipRow}>
              {RATING_OPTIONS.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label}
                  icon={option.value === undefined ? undefined : 'star'}
                  selected={draft.minRating === option.value}
                  onPress={() => {
                    patch({ minRating: option.value });
                  }}
                />
              ))}
            </View>

            <Text style={styles.groupLabel}>Sort by</Text>
            <View accessibilityRole="radiogroup" style={styles.chipRow}>
              {SORT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={draft.sortBy === option.value}
                  onPress={() => {
                    patch({ sortBy: option.value });
                  }}
                />
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={`Show ${String(resultCount)} space${resultCount === 1 ? '' : 's'}`}
              variant="primary"
              onPress={() => {
                onApply(draft);
              }}
            />
            <Button label="Cancel" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface PriceStepperProps {
  readonly caption: string;
  readonly value: string;
  readonly onDecrease: () => void;
  readonly onIncrease: () => void;
}

function PriceStepper({ caption, value, onDecrease, onIncrease }: PriceStepperProps) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperCaption}>{caption}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${caption.toLowerCase()} price`}
          onPress={onDecrease}
          style={styles.stepperButton}
        >
          <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${caption.toLowerCase()} price`}
          onPress={onIncrease}
          style={styles.stepperButton}
        >
          <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '88%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  reset: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: spacing.base,
    gap: spacing.sm,
  },
  groupLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // Restrained, not pill-shaped — the Wayfinder direction's chip shape.
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    // Material's minimum touch target.
    minHeight: 48,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepper: {
    flex: 1,
    gap: spacing.xs,
  },
  stepperCaption: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  stepperButton: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary,
  },
  stepperValue: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
  },
  footer: {
    padding: spacing.base,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
