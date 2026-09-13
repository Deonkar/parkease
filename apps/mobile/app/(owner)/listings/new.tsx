import type { CreateSpace } from '@parkease/contracts/owner';
import type { SpaceSchedule } from '@parkease/contracts/owner';
import { toPaise } from '@parkease/contracts/primitives';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCreateSpace } from '@/features/owner/hooks/useCreateSpace';

type Draft = Partial<CreateSpace>;

const TOTAL_STEPS = 5;

const AMENITY_OPTIONS = [
  { key: 'covered', label: 'Covered' },
  { key: 'cctv', label: 'CCTV' },
  { key: 'guarded', label: 'Guarded' },
  { key: 'ev_charging', label: 'EV Charging' },
  { key: 'lit', label: 'Well Lit' },
  { key: 'wheelchair_accessible', label: 'Wheelchair Access' },
] as const;

const DEFAULT_SCHEDULE: SpaceSchedule = { is24x7: true };

export default function NewListingScreen() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({
    amenities: [],
    schedule: DEFAULT_SCHEDULE,
  });
  const createSpace = useCreateSpace();

  function patch(partial: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function canContinue(): boolean {
    switch (step) {
      case 1:
        return Boolean(
          draft.address?.line && draft.address.city && draft.address.pincode && draft.location,
        );
      case 2:
        return Boolean(draft.title && draft.title.length >= 4);
      case 3:
        return Boolean(draft.slots && (draft.slots.car > 0 || draft.slots.twoWheeler > 0));
      case 4:
        return Boolean(draft.pricing && (draft.pricing.car || draft.pricing.twoWheeler));
      case 5:
        return true;
      default:
        return false;
    }
  }

  async function handleSubmit() {
    const body: CreateSpace = {
      title: draft.title ?? '',
      description: draft.description,
      address: {
        line: draft.address?.line ?? '',
        city: draft.address?.city ?? '',
        pincode: draft.address?.pincode ?? '',
        landmark: draft.address?.landmark,
      },
      location: draft.location ?? { lat: 12.9716, lng: 77.5946 },
      slots: draft.slots ?? { car: 1, twoWheeler: 0 },
      pricing: draft.pricing ?? { car: { hourlyPaise: toPaise(3000) } },
      schedule: draft.schedule ?? DEFAULT_SCHEDULE,
      amenities: draft.amenities ?? [],
      accessInstructions: draft.accessInstructions,
    };

    try {
      await createSpace.mutateAsync(body);
      router.replace('/(owner)/listings');
    } catch {
      Alert.alert('Error', 'Failed to create listing. Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: 'Add a Space', headerBackTitle: 'Back' }} />
      <View style={styles.progress}>
        <View
          style={[
            styles.progressBar,
            { width: `${String((step / TOTAL_STEPS) * 100)}%` as `${number}%` },
          ]}
        />
      </View>
      <Text style={styles.stepLabel}>
        Step {String(step)} of {String(TOTAL_STEPS)}
      </Text>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && <LocationStep draft={draft} patch={patch} />}
          {step === 2 && <DetailsStep draft={draft} patch={patch} />}
          {step === 3 && <SlotsStep draft={draft} patch={patch} />}
          {step === 4 && <PricingStep draft={draft} patch={patch} />}
          {step === 5 && <ScheduleStep draft={draft} patch={patch} />}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 ? (
            <Button
              label="Back"
              variant="secondary"
              onPress={() => {
                setStep((s) => s - 1);
              }}
              style={styles.footerButton}
            />
          ) : (
            <View style={styles.footerButton} />
          )}
          {step < TOTAL_STEPS ? (
            <Button
              label="Continue"
              onPress={() => {
                setStep((s) => s + 1);
              }}
              disabled={!canContinue()}
              style={styles.footerButton}
            />
          ) : (
            <Button
              label="Submit"
              onPress={() => {
                void handleSubmit();
              }}
              loading={createSpace.isPending}
              disabled={!canContinue()}
              style={styles.footerButton}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LocationStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const address = draft.address ?? { line: '', city: '', pincode: '' };
  return (
    <View>
      <Text style={styles.sectionTitle}>Where is it?</Text>
      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapText}>Map — drag to set pin</Text>
      </View>
      <Text style={styles.label}>Address</Text>
      <TextInput
        style={styles.input}
        value={address.line}
        onChangeText={(line) => {
          patch({ address: { ...address, line } });
        }}
        placeholder="Street address"
        accessibilityLabel="Street address"
      />
      <Text style={styles.label}>Landmark (optional)</Text>
      <TextInput
        style={styles.input}
        value={address.landmark ?? ''}
        onChangeText={(landmark) => {
          patch({ address: { ...address, landmark } });
        }}
        placeholder="Near..."
        accessibilityLabel="Landmark"
      />
      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={address.city}
            onChangeText={(city) => {
              patch({ address: { ...address, city } });
            }}
            placeholder="City"
            accessibilityLabel="City"
          />
        </View>
        <View style={styles.halfField}>
          <Text style={styles.label}>PIN Code</Text>
          <TextInput
            style={styles.input}
            value={address.pincode}
            onChangeText={(pincode) => {
              patch({ address: { ...address, pincode } });
            }}
            placeholder="560034"
            keyboardType="number-pad"
            maxLength={6}
            accessibilityLabel="PIN code"
          />
        </View>
      </View>
      {!draft.location ? (
        <Button
          label="Set Location"
          variant="secondary"
          onPress={() => {
            patch({ location: { lat: 12.9716, lng: 77.5946 } });
          }}
        />
      ) : (
        <Text style={styles.hint}>Location set (will be adjustable via map)</Text>
      )}
    </View>
  );
}

function DetailsStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Tell us about your space</Text>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={draft.title ?? ''}
        onChangeText={(title) => {
          patch({ title });
        }}
        placeholder="e.g. Basement Parking, 5th Cross"
        maxLength={80}
        accessibilityLabel="Space title"
      />
      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={draft.description ?? ''}
        onChangeText={(description) => {
          patch({ description });
        }}
        placeholder="Any details drivers should know..."
        multiline
        numberOfLines={4}
        maxLength={1000}
        accessibilityLabel="Description"
      />
      <Text style={styles.label}>Access instructions (optional)</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={draft.accessInstructions ?? ''}
        onChangeText={(accessInstructions) => {
          patch({ accessInstructions });
        }}
        placeholder="How to reach the parking spot..."
        multiline
        numberOfLines={3}
        maxLength={500}
        accessibilityLabel="Access instructions"
      />
      <Text style={styles.label}>Amenities</Text>
      <View style={styles.amenityGrid}>
        {AMENITY_OPTIONS.map((a) => {
          const selected = draft.amenities?.includes(a.key) ?? false;
          return (
            <Pressable
              key={a.key}
              style={[styles.amenityChip, selected && styles.amenityChipSelected]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={a.label}
              onPress={() => {
                const current = draft.amenities ?? [];
                patch({
                  amenities: selected ? current.filter((x) => x !== a.key) : [...current, a.key],
                });
              }}
            >
              <Text style={[styles.amenityLabel, selected && styles.amenityLabelSelected]}>
                {a.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SlotsStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const slots = draft.slots ?? { car: 0, twoWheeler: 0 };

  function setSlots(type: 'car' | 'twoWheeler', delta: number) {
    const current = slots[type];
    const next = Math.max(0, Math.min(50, current + delta));
    patch({ slots: { ...slots, [type]: next } });
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>How many slots?</Text>
      <SlotCounter
        label="Car slots"
        count={slots.car}
        onIncrement={() => {
          setSlots('car', 1);
        }}
        onDecrement={() => {
          setSlots('car', -1);
        }}
      />
      <SlotCounter
        label="Two-wheeler slots"
        count={slots.twoWheeler}
        onIncrement={() => {
          setSlots('twoWheeler', 1);
        }}
        onDecrement={() => {
          setSlots('twoWheeler', -1);
        }}
      />
      <Text style={styles.hint}>{String(slots.car + slots.twoWheeler)} bookable slots total</Text>
    </View>
  );
}

function SlotCounter({
  label,
  count,
  onIncrement,
  onDecrement,
}: {
  label: string;
  count: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={styles.counter}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        <Pressable
          style={styles.counterButton}
          onPress={onDecrement}
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={styles.counterButtonText}>-</Text>
        </Pressable>
        <Text style={styles.counterValue} accessibilityLabel={`${label}: ${String(count)}`}>
          {String(count)}
        </Text>
        <Pressable
          style={styles.counterButton}
          onPress={onIncrement}
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={styles.counterButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PricingStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const slots = draft.slots ?? { car: 0, twoWheeler: 0 };
  const pricing = draft.pricing ?? {};

  function setPaise(vehicleType: 'car' | 'twoWheeler', field: string, text: string) {
    const raw = Math.round(Number(text) * 100) || 0;
    const current = pricing[vehicleType] ?? { hourlyPaise: toPaise(0) };
    patch({
      pricing: {
        ...pricing,
        [vehicleType]: { ...current, [field]: raw > 0 ? toPaise(raw) : undefined },
      },
    });
  }

  function displayRupees(paise: number | undefined): string {
    if (!paise) return '';
    return String(paise / 100);
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Set your pricing</Text>
      {slots.car > 0 && (
        <View style={styles.pricingSection}>
          <Text style={styles.label}>Car pricing (per slot)</Text>
          <PriceInput
            label="Hourly (required)"
            value={displayRupees(pricing.car?.hourlyPaise)}
            onChangeText={(t) => {
              setPaise('car', 'hourlyPaise', t);
            }}
          />
          <PriceInput
            label="Daily (optional)"
            value={displayRupees(pricing.car?.dailyPaise)}
            onChangeText={(t) => {
              setPaise('car', 'dailyPaise', t);
            }}
          />
        </View>
      )}
      {slots.twoWheeler > 0 && (
        <View style={styles.pricingSection}>
          <Text style={styles.label}>Two-wheeler pricing (per slot)</Text>
          <PriceInput
            label="Hourly (required)"
            value={displayRupees(pricing.twoWheeler?.hourlyPaise)}
            onChangeText={(t) => {
              setPaise('twoWheeler', 'hourlyPaise', t);
            }}
          />
          <PriceInput
            label="Daily (optional)"
            value={displayRupees(pricing.twoWheeler?.dailyPaise)}
            onChangeText={(t) => {
              setPaise('twoWheeler', 'dailyPaise', t);
            }}
          />
        </View>
      )}
    </View>
  );
}

function PriceInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
}) {
  return (
    <View style={styles.priceRow}>
      <Text style={styles.priceLabel}>{label}</Text>
      <View style={styles.priceInputContainer}>
        <Text style={styles.rupeeSign}>₹</Text>
        <TextInput
          style={styles.priceInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          placeholder="0"
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

function ScheduleStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const is24x7 = draft.schedule?.is24x7 ?? true;

  return (
    <View>
      <Text style={styles.sectionTitle}>Availability</Text>
      <Pressable
        style={[styles.scheduleOption, is24x7 && styles.scheduleOptionSelected]}
        onPress={() => {
          patch({ schedule: { is24x7: true } });
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: is24x7 }}
      >
        <Text style={styles.scheduleOptionText}>Available 24/7</Text>
      </Pressable>
      <Pressable
        style={[styles.scheduleOption, !is24x7 && styles.scheduleOptionSelected]}
        onPress={() => {
          patch({
            schedule: {
              is24x7: false,
              days: {
                mon: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                tue: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                wed: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                thu: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                fri: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                sat: { isOpen: true, opensAt: '06:00', closesAt: '22:00' },
                sun: { isOpen: true, opensAt: '08:00', closesAt: '20:00' },
              },
            },
          });
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: !is24x7 }}
      >
        <Text style={styles.scheduleOptionText}>Custom hours</Text>
      </Pressable>
      {!is24x7 && (
        <Text style={styles.hint}>
          Default: Mon-Sat 6AM-10PM, Sun 8AM-8PM. Editable after creation.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  progress: {
    height: 4,
    backgroundColor: colors.surfaceTertiary,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.primary,
  },
  stepLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  content: {
    padding: spacing.base,
    paddingBottom: spacing['2xl'],
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.base,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfField: {
    flex: 1,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  mapPlaceholder: {
    height: 160,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  mapText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
  },
  amenityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  amenityChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  amenityChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.infoLight,
  },
  amenityLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  amenityLabelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  counter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  counterLabel: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.text,
  },
  counterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  counterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.text,
  },
  counterValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    minWidth: 40,
    textAlign: 'center',
  },
  pricingSection: {
    marginBottom: spacing.base,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  priceLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    flex: 1,
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    width: 120,
  },
  rupeeSign: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  priceInput: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  scheduleOption: {
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: spacing.sm,
  },
  scheduleOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.infoLight,
  },
  scheduleOptionText: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.text,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  footerButton: {
    flex: 1,
  },
});
