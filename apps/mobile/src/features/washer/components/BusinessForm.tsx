import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CarwashServiceName } from '@parkease/contracts/enums';
import type { CreateWasherProfile } from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HeldUploads } from '../hooks/useHeldUploads';
import {
  buildBusinessProfile,
  formatTime12,
  stepTime,
  type FieldErrors,
  type RegistrationField,
  withoutError,
} from '../registration';

import { FieldBlock, ServiceChecklist, SubmitBlock, TextField } from './FormFields';
import { PhotoField } from './PhotoField';

/** Enough to show a shop and a bay; each one is an upload on a mobile data plan. */
export const MAX_BUSINESS_PHOTOS = 6;

/** §14.2's example range, which is also the commonest one. */
const DEFAULT_OPENS = '07:00';
const DEFAULT_CLOSES = '20:00';

/** G9: a failed photo blocks the submit rather than being left out of it. */
const PHOTO_NOT_SENT = "A photo didn't upload. Retry it or remove it, then submit.";

export interface BusinessFormProps {
  readonly photos: HeldUploads;
  readonly onTakePhoto: () => void;
  readonly submitting: boolean;
  /** Why the last submit failed on the server, said next to the submit. */
  readonly failure: string | null;
  readonly onSubmit: (profile: CreateWasherProfile) => void;
}

/**
 * The business registration of §14.2: name, optional GSTIN, photos, hours and
 * services, sent as ONE `createProfile` carrying the photo ids. It is the whole
 * submission for review (ruling T10-C1): the server lands it `pending`.
 */
export function BusinessForm({
  photos,
  onTakePhoto,
  submitting,
  failure,
  onSubmit,
}: BusinessFormProps) {
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [opens, setOpens] = useState(DEFAULT_OPENS);
  const [closes, setCloses] = useState(DEFAULT_CLOSES);
  const [services, setServices] = useState<readonly CarwashServiceName[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});

  const clear = (field: RegistrationField) => {
    setErrors((current) => withoutError(current, field));
  };

  const submit = () => {
    // Sending the photos that arrived and quietly leaving out the one that did
    // not is a registration the partner did not make (G9).
    if (photos.items.some((item) => item.error !== null)) {
      setErrors((current) => ({ ...current, photos: PHOTO_NOT_SENT }));
      return;
    }
    const built = buildBusinessProfile({
      businessName,
      gstin,
      photoIds: photos.uploadIds,
      opens,
      closes,
      services,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    onSubmit(built.profile);
  };

  return (
    <View style={styles.form}>
      <TextField
        id="name"
        label="Business name"
        value={businessName}
        onChangeText={(value) => {
          setBusinessName(value);
          clear('name');
        }}
        autoComplete="organization"
        maxLength={120}
        error={errors.name}
      />

      <TextField
        id="gstin"
        label="GSTIN (optional)"
        hint="15 characters, on your GST registration certificate."
        value={gstin}
        onChangeText={(value) => {
          setGstin(value);
          clear('gstin');
        }}
        autoCapitalize="characters"
        maxLength={15}
        error={errors.gstin}
      />

      <PhotoField
        id="photos"
        label="Business photos"
        hint="At least one: the front of your shop or your wash bay."
        uploads={photos}
        max={MAX_BUSINESS_PHOTOS}
        addLabel="Add photo"
        onAdd={() => {
          clear('photos');
          onTakePhoto();
        }}
        error={errors.photos}
      />

      <FieldBlock
        id="hours"
        label="Operating hours"
        hint="The same hours every day."
        error={errors.hours}
      >
        <View style={styles.hours} testID="hours-control">
          <TimeStepper
            id="opens"
            label="Opens"
            value={opens}
            onChange={(next) => {
              setOpens(next);
              clear('hours');
            }}
          />
          <TimeStepper
            id="closes"
            label="Closes"
            value={closes}
            onChange={(next) => {
              setCloses(next);
              clear('hours');
            }}
          />
        </View>
      </FieldBlock>

      <ServiceChecklist
        label="Services you offer"
        selected={services}
        onToggle={(service) => {
          setServices((current) =>
            current.includes(service)
              ? current.filter((s) => s !== service)
              : [...current, service],
          );
          clear('services');
        }}
        error={errors.services}
      />

      <SubmitBlock
        label="Submit for review"
        waitingForUploads={photos.busy}
        submitting={submitting}
        failure={failure}
        onPress={submit}
      />
    </View>
  );
}

interface TimeStepperProps {
  readonly id: 'opens' | 'closes';
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * A time in half-hour steps (ruling T10-D3). No time-picker dependency, no
 * typing on a number pad that has no colon, and no invalid state to explain:
 * the stepper can only produce an `HH:mm` the contract accepts. TalkBack gets
 * it as one adjustable control; sighted users get two 48dp buttons.
 */
function TimeStepper({ id, label, value, onChange }: TimeStepperProps) {
  const shown = formatTime12(value);
  const verb = id === 'opens' ? 'Open' : 'Close';

  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View
        style={styles.stepperRow}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} at`}
        accessibilityValue={{ text: shown }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          onChange(stepTime(value, event.nativeEvent.actionName === 'increment' ? 1 : -1));
        }}
      >
        <Pressable
          testID={`${id}-earlier`}
          accessibilityRole="button"
          accessibilityLabel={`${verb} half an hour earlier`}
          onPress={() => {
            onChange(stepTime(value, -1));
          }}
          style={styles.step}
        >
          <MaterialCommunityIcons name="minus" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.time}>{shown}</Text>
        <Pressable
          testID={`${id}-later`}
          accessibilityRole="button"
          accessibilityLabel={`${verb} half an hour later`}
          onPress={() => {
            onChange(stepTime(value, 1));
          }}
          style={styles.step}
        >
          <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl },
  hours: { flexDirection: 'row', gap: spacing.md },
  stepper: { flex: 1, gap: spacing.xs },
  stepperLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textTertiary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  step: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  time: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
