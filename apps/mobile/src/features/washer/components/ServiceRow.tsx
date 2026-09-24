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
import {
  colors,
  elevation,
  fontSize,
  fontWeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { announce, useAnnounce } from '@/features/shared/hooks/useAnnounce';
import { formatPaise } from '@/lib/money';

import { SERVICE_LABELS } from '../labels';
import { paiseToRupees, parseMinutes, rupeesToPaise, type MenuRow } from '../menu-rows';

import { FieldError } from './FieldError';
import { switchColors } from './switch-colors';

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

const UNPRICED_SWITCH = 'Set both prices and save them to switch this service on.';

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
 * partner saves, never on a keystroke — `9` may be the start of `99` — and a
 * shown error clears the moment the partner starts fixing it.
 *
 * The switch saves straight away, because a switch that waits for a Save
 * button is a switch that lies about its state. It sends the SERVER's prices
 * and duration with the new `isActive`, never the drafts (T8-I1): an unsaved
 * typo must not go live with a flip, and an invalid draft must never block
 * switching a service off. While that save is in flight the switch shows the
 * value it is saving. A never-priced service has nothing to switch on, so the
 * switch waits, and says so, until prices are saved.
 *
 * When the server's PRICES or duration change, the row takes them over in
 * place — never over `isActive`, so a toggle keeps what was typed (T8-I1). It
 * used to be remounted by a `key` over those values, which moved TalkBack's
 * focus off the Save the partner had just pressed (H6); it is now updated
 * without remounting, and a save that lands is announced as "Saved".
 */
export function ServiceRow({ row, onSave, saving = false, failure = null }: ServiceRowProps) {
  const name = row.serviceName;
  const label = SERVICE_LABELS[name];
  const baseline = textOf(row);

  const [text, setText] = useState(baseline);
  const [shown, setShown] = useState(NONE_SHOWN);
  // H6: the server's values this row's text was last taken from. A change is
  // adopted during render — React's pattern for resetting state from a prop —
  // so there is no frame showing the old prices, and nothing remounts.
  const baselineKey = `${baseline.car}:${baseline.bike}:${baseline.duration}`;
  const [syncedFrom, setSyncedFrom] = useState(baselineKey);
  if (syncedFrom !== baselineKey) {
    setSyncedFrom(baselineKey);
    setText(baseline);
    setShown(NONE_SHOWN);
  }
  /** A save of this row landed and nothing has been typed since. */
  const [justSaved, setJustSaved] = useState(false);
  const wasSaving = useRef(saving);
  useEffect(() => {
    if (wasSaving.current && !saving && failure === null) {
      setJustSaved(true);
      announce('Saved');
    }
    wasSaving.current = saving;
  }, [saving, failure]);
  useAnnounce(failure);
  const [focused, setFocused] = useState<Field | null>(null);
  /** What the last flip asked for; shown only while a save is in flight. */
  const [pendingActive, setPendingActive] = useState<boolean | null>(null);
  /** The stored values could not be sent as they are (see `toggle`). */
  const [toggleRefused, setToggleRefused] = useState(false);

  const parsed = {
    car: rupeesToPaise(text.car),
    bike: rupeesToPaise(text.bike),
    duration: parseMinutes(text.duration),
  };
  const invalid = (field: Field) => shown[field] && parsed[field] === null;

  // Either price missing is a service the partner has not finished setting up.
  const unpriced = row.carPricePaise === null || row.bikePricePaise === null;
  const offered = saving && pendingActive !== null ? pendingActive : row.isActive;

  // Changed means a different VALUE (T8-M3): "399.00" over a stored ₹399 is
  // not an edit. A field that will not parse is compared as text, so a
  // half-typed price still enables Save, which is where it gets explained.
  const server = {
    car: row.carPricePaise,
    bike: row.bikePricePaise,
    duration: row.durationMinutes,
  };
  const changed = (field: Field) =>
    parsed[field] === null ? text[field] !== baseline[field] : parsed[field] !== server[field];
  const dirty = changed('car') || changed('bike') || changed('duration');

  const change = (field: Field, value: string) => {
    setJustSaved(false);
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

  const save = () => {
    setPendingActive(null);
    setToggleRefused(false);
    setShown(ALL_SHOWN);
    const input = upsertWashServiceSchema.safeParse({
      carPricePaise: parsed.car,
      bikePricePaise: parsed.bike,
      durationMinutes: parsed.duration,
      // Pricing a service for the first time is asking to offer it.
      isActive: row.isActive || unpriced,
    });
    // Not silent: every field that failed is now saying why, under itself.
    if (!input.success) return;
    onSave(input.data);
  };

  const toggle = (next: boolean) => {
    const input = upsertWashServiceSchema.safeParse({
      carPricePaise: row.carPricePaise,
      bikePricePaise: row.bikePricePaise,
      durationMinutes: row.durationMinutes,
      isActive: next,
    });
    // The read schema is looser than the write schema, so a stored price
    // outside the bounds can reach this screen but cannot be sent back. Said
    // under the switch, never dropped: the partner re-prices and saves.
    if (!input.success) {
      setToggleRefused(true);
      return;
    }
    setToggleRefused(false);
    setPendingActive(next);
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
          <Text style={[styles.state, offered && styles.stateOn]}>
            {saving && pendingActive !== null ? 'Saving…' : offered ? 'Offered' : 'Not offered'}
          </Text>
        </View>
        <Switch
          testID={`active-${name}`}
          accessibilityRole="switch"
          // A fixed label (H8): the checked state says whether it is offered.
          accessibilityLabel={`Offer ${label}`}
          // TalkBack on a disabled switch otherwise hears only "disabled".
          accessibilityHint={unpriced ? UNPRICED_SWITCH : undefined}
          accessibilityState={{ checked: offered, disabled: saving || unpriced, busy: saving }}
          disabled={saving || unpriced}
          value={offered}
          onValueChange={toggle}
          {...switchColors(colors.primary)}
        />
      </View>

      {unpriced ? (
        <Text style={styles.prompt}>
          Set your prices to offer this service, then save them to switch it on.
        </Text>
      ) : null}

      {toggleRefused ? (
        <FieldError
          testID={`active-error-${name}`}
          message={`The saved prices can't be sent as they are. ${PRICE_ERROR}, then save.`}
        />
      ) : null}

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
          onPress={save}
          // Material wants touch feedback; a pressed tone from the tokens gives it.
          style={({ pressed }) => [
            styles.save,
            pressed && styles.savePressed,
            (!dirty || saving) && styles.saveDisabled,
          ]}
        >
          <Text style={[styles.saveLabel, (!dirty || saving) && styles.saveLabelDisabled]}>
            {saving ? 'Saving…' : justSaved && !dirty ? 'Saved' : 'Save'}
          </Text>
        </Pressable>
      </View>

      {failure === null ? null : (
        <View style={styles.failure} testID={`save-error-${name}`}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.errorInk} />
          <Text style={styles.failureText}>{failure}</Text>
        </View>
      )}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
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
    minHeight: touchTarget,
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
    minHeight: touchTarget,
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
    minHeight: touchTarget,
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
