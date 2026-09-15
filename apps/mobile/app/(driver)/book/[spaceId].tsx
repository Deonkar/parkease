import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateIST, formatTimeIST } from '@/lib/format';

import { SegmentedChoice } from '../../../src/features/driver/components/SegmentedChoice';
import { useSpaceDetail } from '../../../src/features/driver/hooks/useBookings';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

type VehicleType = 'car' | 'two_wheeler';
type DurationType = 'hourly' | 'daily' | 'weekly' | 'monthly';

const MS_PER_HOUR = 3_600_000;
const UNIT_HOURS: Readonly<Record<DurationType, number>> = {
  hourly: 1,
  daily: 24,
  weekly: 24 * 7,
  monthly: 24 * 30,
};

/** How many units the stepper offers per plan. One month of monthly is plenty. */
const MAX_UNITS: Readonly<Record<DurationType, number>> = {
  hourly: 12,
  daily: 14,
  weekly: 8,
  monthly: 6,
};

const INDIAN_PLATE = /^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{0,3}[-\s]?\d{1,4}$/;

/**
 * The opt-in path in Direction C. Most drivers never see this screen — the space
 * detail button already offers a priced default — so it is built for the
 * minority who genuinely need to move the window, not as the main road.
 *
 * It deliberately shows no total. A price on this screen would have to be
 * computed on the device (R-FE-06), and a client-side estimate that disagrees
 * with the server by the surge multiplier is worse than no number: the next
 * screen creates the booking and shows the real one.
 */
export default function ConfigureBookingScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const insets = useSafeAreaInsets();
  const { data: space, isPending, isError, refetch } = useSpaceDetail(spaceId);

  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [durationType, setDurationType] = useState<DurationType>('hourly');
  const [units, setUnits] = useState(2);
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [plate, setPlate] = useState('');
  const [plateTouched, setPlateTouched] = useState(false);

  const resolvedVehicle: VehicleType =
    vehicleType ??
    space?.defaultBooking?.vehicleType ??
    (space?.pricing.car ? 'car' : 'two_wheeler');

  const resolvedStart = useMemo(() => {
    if (startsAt !== null) return startsAt;
    const fromDefault = space?.defaultBooking?.startsAt;
    return fromDefault === undefined ? new Date() : new Date(fromDefault);
  }, [startsAt, space?.defaultBooking?.startsAt]);

  const endsAt = new Date(resolvedStart.getTime() + units * UNIT_HOURS[durationType] * MS_PER_HOUR);

  const plateError =
    plateTouched && plate.length > 0 && !INDIAN_PLATE.test(plate.trim().toUpperCase())
      ? 'That does not look like an Indian number plate. Example: KA-01-AB-1234'
      : null;

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Choose your time" />
        <View style={styles.screen}>
          <View style={styles.content}>
            <Skeleton width="100%" height={72} />
            <Skeleton width="100%" height={72} />
            <Skeleton width="100%" height={96} />
          </View>
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load this space"
        body="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }

  const rateCard = resolvedVehicle === 'car' ? space.pricing.car : space.pricing.twoWheeler;
  const planAvailable = (plan: DurationType): boolean => {
    if (rateCard === null) return false;
    const key =
      `${plan === 'hourly' ? 'hourly' : plan === 'daily' ? 'daily' : plan === 'weekly' ? 'weekly' : 'monthly'}Paise` as const;
    const value = rateCard[key];
    return value !== null && value > 0;
  };

  const canContinue = rateCard !== null && planAvailable(durationType) && plateError === null;

  return (
    <>
      <ScreenHeader title="Choose your time" />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SegmentedChoice<VehicleType>
          label="Vehicle"
          value={resolvedVehicle}
          onChange={setVehicleType}
          choices={[
            { value: 'car', label: 'Car', disabled: space.pricing.car === null },
            {
              value: 'two_wheeler',
              label: 'Two-wheeler',
              disabled: space.pricing.twoWheeler === null,
            },
          ]}
        />

        <SegmentedChoice<DurationType>
          label="Plan"
          value={durationType}
          onChange={(next) => {
            setDurationType(next);
            setUnits(next === 'hourly' ? 2 : 1);
          }}
          choices={[
            { value: 'hourly', label: 'Hourly', disabled: !planAvailable('hourly') },
            { value: 'daily', label: 'Daily', disabled: !planAvailable('daily') },
            { value: 'weekly', label: 'Weekly', disabled: !planAvailable('weekly') },
            { value: 'monthly', label: 'Monthly', disabled: !planAvailable('monthly') },
          ]}
        />

        <View style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header">
            How long
          </Text>
          <Stepper
            value={units}
            min={1}
            max={MAX_UNITS[durationType]}
            unit={durationType === 'hourly' ? 'hour' : durationType.replace('ly', '')}
            onChange={setUnits}
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header">
            Starts
          </Text>
          <View style={styles.startRow}>
            {[0, 30, 60, 120].map((offsetMinutes) => {
              const candidate = new Date(Date.now() + offsetMinutes * 60_000);
              const active = Math.abs(candidate.getTime() - resolvedStart.getTime()) < 5 * 60_000;
              return (
                <Pressable
                  key={offsetMinutes}
                  onPress={() => {
                    setStartsAt(candidate);
                  }}
                  style={[styles.startChip, active && styles.startChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    offsetMinutes === 0 ? 'Start now' : `Start in ${String(offsetMinutes)} minutes`
                  }
                >
                  <Text style={[styles.startChipText, active && styles.startChipTextActive]}>
                    {offsetMinutes === 0 ? 'Now' : `+${String(offsetMinutes)}m`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.windowLine}>
            {formatDateIST(resolvedStart)} · {formatTimeIST(resolvedStart)} to{' '}
            {formatTimeIST(endsAt)}
          </Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header">
            Vehicle number
          </Text>
          <TextInput
            value={plate}
            onChangeText={(next) => {
              setPlate(next.toUpperCase());
            }}
            onBlur={() => {
              setPlateTouched(true);
            }}
            placeholder="KA-01-AB-1234"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, plateError !== null && styles.inputError]}
            accessibilityLabel="Vehicle number, optional"
          />
          {plateError === null ? (
            <Text style={styles.hint}>Optional. Helps the owner find your car.</Text>
          ) : (
            <Text style={styles.error}>{plateError}</Text>
          )}
        </View>

        {rateCard === null ? (
          <View style={styles.notice}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.surge} />
            <Text style={styles.noticeText}>
              This space isn&rsquo;t priced for that vehicle. Pick the other one.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="See the price"
          disabled={!canContinue}
          onPress={() => {
            router.push({
              pathname: '/(driver)/book/review',
              params: {
                spaceId: space.id,
                vehicleType: resolvedVehicle,
                durationType,
                startsAt: resolvedStart.toISOString(),
                endsAt: endsAt.toISOString(),
                ...(plate.trim().length > 0 ? { vehicleNumber: plate.trim() } : {}),
              },
            });
          }}
        />
      </View>
    </>
  );
}

function Stepper({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly onChange: (next: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => {
          onChange(Math.max(min, value - 1));
        }}
        disabled={value <= min}
        style={[styles.stepButton, value <= min && styles.stepButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel={`Decrease to ${String(Math.max(min, value - 1))} ${unit}s`}
      >
        <MaterialCommunityIcons
          name="minus"
          size={20}
          color={value <= min ? colors.textTertiary : colors.primary}
        />
      </Pressable>

      <Text style={styles.stepValue} accessibilityLiveRegion="polite">
        {String(value)} {unit}
        {value === 1 ? '' : 's'}
      </Text>

      <Pressable
        onPress={() => {
          onChange(Math.min(max, value + 1));
        }}
        disabled={value >= max}
        style={[styles.stepButton, value >= max && styles.stepButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel={`Increase to ${String(Math.min(max, value + 1))} ${unit}s`}
      >
        <MaterialCommunityIcons
          name="plus"
          size={20}
          color={value >= max ? colors.textTertiary : colors.primary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  content: {
    gap: spacing.xl,
    padding: spacing.base,
    paddingBottom: spacing['2xl'],
  },
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 1,
  },
  stepValue: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  startRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  startChip: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  startChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  startChipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  startChipTextActive: {
    color: colors.primaryDark,
    fontWeight: fontWeight.semibold,
  },
  windowLine: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: fontSize.base,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.error,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  error: {
    fontSize: fontSize.xs,
    color: colors.errorInk,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surgeSoft,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.surge,
  },
  dock: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
