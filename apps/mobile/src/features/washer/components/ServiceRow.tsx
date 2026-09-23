import { MaterialCommunityIcons } from '@expo/vector-icons';
import { toPaise } from '@parkease/contracts/primitives';
import {
  MAX_SERVICE_DURATION_MINUTES,
  MAX_SERVICE_PRICE_PAISE,
  MIN_SERVICE_DURATION_MINUTES,
  MIN_SERVICE_PRICE_PAISE,
  upsertWashServiceSchema,
  type UpsertWashService,
} from '@parkease/contracts/washer';
import { colors, elevation, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { formatPaise } from '@/lib/money';

import { SERVICE_LABELS } from '../labels';
import { paiseToRupees, parseMinutes, rupeesToPaise, type MenuRow } from '../menu-rows';

export interface ServiceRowProps {
  readonly row: MenuRow;
  /** Both prices, the duration and the switch, as one upsert (spec §6.3). */
  readonly onSave: (input: UpsertWashService) => void;
  /** A save of this row is in flight: Save and the switch wait for the answer. */
  readonly saving?: boolean;
  /** Why the last save of this row failed, said under the row. */
  readonly failure?: string | null;
}

type Field = 'car' | 'bike' | 'duration';
type PriceField = Exclude<Field, 'duration'>;

// Built from the contract's own bounds, so the copy cannot drift from what the
// API enforces: "Enter a price between ₹10 and ₹9,999".
const PRICE_ERROR = `Enter a price between ${formatPaise(toPaise(MIN_SERVICE_PRICE_PAISE))} and ${formatPaise(toPaise(MAX_SERVICE_PRICE_PAISE))}`;
const DURATION_ERROR = `Enter a time between ${String(MIN_SERVICE_DURATION_MINUTES)} and ${String(MAX_SERVICE_DURATION_MINUTES)} minutes`;

const SLOT_NAME: Readonly<Record<PriceField, string>> = { car: 'Car', bike: 'Bike' };
const SLOT_ICON: Readonly<Record<PriceField, 'car-side' | 'motorbike'>> = {
  car: 'car-side',
  bike: 'motorbike',
};

const NONE_SHOWN: Readonly<Record<Field, boolean>> = { car: false, bike: false, duration: false };
const ALL_SHOWN: Readonly<Record<Field, boolean>> = { car: true, bike: true, duration: true };

const textOf = (row: MenuRow): Record<Field, string> => ({
  car: row.carPricePaise === null ? '' : paiseToRupees(row.carPricePaise),
  bike: row.bikePricePaise === null ? '' : paiseToRupees(row.bikePricePaise),
  duration: String(row.durationMinutes),
});

/**
 * One service on the menu: a car price and a bike price side by side, the
 * minutes it takes, and whether it is offered (spec §6.3).
 *
 * The two price slots rhyme with the evidence pair (spec §2): two equal framed
 * halves, dashed while nothing is in them, solid once they hold a price, red
 * when what they hold would be refused. One visual idea, used twice.
 *
 * Validation speaks late. A field is judged when it loses focus or when the
 * partner saves, never on a keystroke — `10.` is a price being typed, not a
 * mistake — and a shown error clears the moment the partner starts fixing it.
 *
 * The switch saves straight away, because a switch that waits for a Save
 * button is a switch that lies about its state. It sends the prices on screen
 * with the new `isActive`, so switching a service off keeps its prices.
 *
 * The screen resets this row by remounting it (a `key` over its server values),
 * so a failed save keeps what the partner typed and a successful one shows what
 * the server now holds.
 */
export function ServiceRow({ row, onSave, saving = false, failure = null }: ServiceRowProps) {
  const name = row.serviceName;
  const label = SERVICE_LABELS[name];
  const baseline = textOf(row);

  const [text, setText] = useState(baseline);
  const [shown, setShown] = useState(NONE_SHOWN);
  const [focused, setFocused] = useState<Field | null>(null);

  const parsed = {
    car: rupeesToPaise(text.car),
    bike: rupeesToPaise(text.bike),
    duration: parseMinutes(text.duration),
  };
  const invalid = (field: Field) => shown[field] && parsed[field] === null;

  // Either price missing is a service the partner has not finished setting up.
  const unpriced = row.carPricePaise === null || row.bikePricePaise === null;
  const dirty =
    text.car !== baseline.car || text.bike !== baseline.bike || text.duration !== baseline.duration;

  const change = (field: Field, value: string) => {
    setText((current) => ({ ...current, [field]: value }));
    // Correcting a field un-says its error until the partner is done with it.
    setShown((current) => ({ ...current, [field]: false }));
  };

  const blur = (field: Field) => {
    setFocused(null);
    // An empty field the partner merely passed through is not yet a mistake;
    // Save is where "both prices are needed" gets said.
    setShown((current) => ({ ...current, [field]: text[field].trim() !== '' }));
  };

  const commit = (isActive: boolean) => {
    setShown(ALL_SHOWN);
    const input = upsertWashServiceSchema.safeParse({
      carPricePaise: parsed.car,
      bikePricePaise: parsed.bike,
      durationMinutes: parsed.duration,
      isActive,
    });
    // Not silent: every field that failed is now saying why, under itself.
    if (!input.success) return;
    onSave(input.data);
  };

  const priceSlot = (field: PriceField) => {
    const error = invalid(field);
    return (
      <View style={styles.half}>
        <View
          style={[
            styles.slot,
            text[field] === '' && styles.slotEmpty,
            focused === field && styles.slotFocused,
            error && styles.slotError,
          ]}
        >
          <View style={styles.slotHead}>
            <MaterialCommunityIcons name={SLOT_ICON[field]} size={16} color={colors.textTertiary} />
            <Text style={styles.slotName}>{SLOT_NAME[field]}</Text>
          </View>
          <View style={styles.amount}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              testID={`price-${field}-${name}`}
              value={text[field]}
              onChangeText={(value) => {
                change(field, value);
              }}
              onFocus={() => {
                setFocused(field);
              }}
              onBlur={() => {
                blur(field);
              }}
              keyboardType="decimal-pad"
              returnKeyType="done"
              maxLength={7}
              placeholder="—"
              placeholderTextColor={colors.muted}
              selectTextOnFocus
              accessibilityLabel={`${label}, ${SLOT_NAME[field].toLowerCase()} price in rupees`}
              accessibilityHint={error ? PRICE_ERROR : undefined}
              style={styles.priceInput}
            />
          </View>
        </View>
        {error ? (
          <FieldError testID={`price-${field}-error-${name}`} message={PRICE_ERROR} />
        ) : null}
      </View>
    );
  };

  const durationError = invalid('duration');

  return (
    <View style={styles.card} testID={`service-${name}`}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.name} accessibilityRole="header">
            {label}
          </Text>
          <Text style={[styles.state, row.isActive && styles.stateOn]}>
            {row.isActive ? 'Offered' : 'Not offered'}
          </Text>
        </View>
        <Switch
          testID={`active-${name}`}
          accessibilityRole="switch"
          accessibilityLabel={`${label}: ${row.isActive ? 'offered' : 'not offered'}`}
          accessibilityState={{ checked: row.isActive, disabled: saving, busy: saving }}
          disabled={saving}
          value={row.isActive}
          onValueChange={commit}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>

      {unpriced ? <Text style={styles.prompt}>Set your prices to offer this service</Text> : null}

      <View style={styles.pair}>
        {priceSlot('car')}
        {priceSlot('bike')}
      </View>

      <View style={styles.foot}>
        <View style={styles.durationBlock}>
          <View style={styles.durationRow}>
            <Text style={styles.durationLabel}>Takes</Text>
            <TextInput
              testID={`duration-${name}`}
              value={text.duration}
              onChangeText={(value) => {
                change('duration', value);
              }}
              onFocus={() => {
                setFocused('duration');
              }}
              onBlur={() => {
                blur('duration');
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={3}
              selectTextOnFocus
              accessibilityLabel={`${label}, time taken in minutes`}
              accessibilityHint={durationError ? DURATION_ERROR : undefined}
              style={[
                styles.durationInput,
                focused === 'duration' && styles.slotFocused,
                durationError && styles.slotError,
              ]}
            />
            <Text style={styles.durationLabel}>min</Text>
          </View>
          {durationError ? (
            <FieldError testID={`duration-error-${name}`} message={DURATION_ERROR} />
          ) : null}
        </View>

        <Pressable
          testID={`save-${name}`}
          accessibilityRole="button"
          accessibilityLabel={`Save ${label}`}
          accessibilityState={{ disabled: !dirty || saving, busy: saving }}
          disabled={!dirty || saving}
          onPress={() => {
            // Pricing a service for the first time is asking to offer it.
            commit(row.isActive || unpriced);
          }}
          // Material wants touch feedback; a pressed tone from the tokens gives it.
          style={({ pressed }) => [
            styles.save,
            pressed && styles.savePressed,
            (!dirty || saving) && styles.saveDisabled,
          ]}
        >
          <Text style={[styles.saveLabel, (!dirty || saving) && styles.saveLabelDisabled]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      </View>

      {failure === null ? null : (
        <View style={styles.failure} testID={`save-error-${name}`} accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.errorInk} />
          <Text style={styles.failureText}>{failure}</Text>
        </View>
      )}
    </View>
  );
}

function FieldError({ testID, message }: { readonly testID: string; readonly message: string }) {
  return (
    <View style={styles.fieldError} testID={testID} accessibilityLiveRegion="polite">
      <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.errorInk} />
      <Text style={styles.fieldErrorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  headText: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  state: { fontSize: fontSize.sm, color: colors.textTertiary },
  stateOn: { color: colors.textSecondary, fontWeight: fontWeight.semibold },
  prompt: { fontSize: fontSize.sm, color: colors.textSecondary },
  // The evidence pair's geometry: two equal halves, `spacing.md` apart.
  pair: { flexDirection: 'row', gap: spacing.md },
  half: { flexGrow: 1, flexBasis: 0, gap: spacing.xs },
  slot: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  // Unpriced reads like an owed photo: dashed, on the plain surface.
  slotEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  slotFocused: { borderStyle: 'solid', borderColor: colors.borderFocused },
  slotError: { borderStyle: 'solid', borderColor: colors.error },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  slotName: {
    textTransform: 'uppercase',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  amount: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rupee: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textSecondary },
  priceInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 0,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  foot: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  durationBlock: { flex: 1, gap: spacing.xs },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  durationLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  durationInput: {
    minWidth: spacing['3xl'] + spacing.base,
    minHeight: 44,
    paddingVertical: 0,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  save: {
    minHeight: 44,
    minWidth: spacing['3xl'] * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  savePressed: { backgroundColor: colors.primaryDark },
  saveDisabled: { backgroundColor: colors.surfaceTertiary },
  saveLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textInverse },
  saveLabelDisabled: { color: colors.textTertiary },
  fieldError: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  fieldErrorText: { flex: 1, fontSize: fontSize.xs, color: colors.errorInk },
  failure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
  },
  failureText: { flex: 1, fontSize: fontSize.sm, color: colors.errorInk },
});
