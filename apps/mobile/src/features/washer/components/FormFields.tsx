import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CARWASH_SERVICE_NAME_VALUES, type CarwashServiceName } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FieldError } from '@/features/shared/components/FieldError';
import { FieldBlock } from '@/features/shared/components/FormFields';

import { SERVICE_LABELS } from '../labels';

export {
  FieldBlock,
  TextField,
  type FieldBlockProps,
  type TextFieldProps,
} from '@/features/shared/components/FormFields';

export interface ServiceChecklistProps {
  readonly label: string;
  readonly selected: readonly CarwashServiceName[];
  readonly onToggle: (service: CarwashServiceName) => void;
  readonly error?: string | undefined;
}

/**
 * The five services of the closed catalogue, in catalogue order. What is ticked
 * is what the partner is offered (ruling T10-S1), so each row says its state in
 * words to TalkBack as well as with the box.
 */
export function ServiceChecklist({ label, selected, onToggle, error }: ServiceChecklistProps) {
  return (
    <FieldBlock
      id="services"
      label={label}
      hint="You'll only get jobs for the ones you tick. You can change this later in Menu."
      error={error}
    >
      <View style={styles.checklist} testID="services-control">
        {CARWASH_SERVICE_NAME_VALUES.map((service) => {
          const checked = selected.includes(service);
          return (
            <Pressable
              key={service}
              testID={`service-${service}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={SERVICE_LABELS[service]}
              onPress={() => {
                onToggle(service);
              }}
              android_ripple={{ color: colors.surfaceTertiary }}
              style={styles.check}
            >
              <MaterialCommunityIcons
                name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={24}
                color={checked ? colors.primary : colors.textTertiary}
              />
              <Text style={[styles.checkLabel, checked && styles.checkLabelOn]}>
                {SERVICE_LABELS[service]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </FieldBlock>
  );
}

export interface SubmitBlockProps {
  readonly label: string;
  /** A photo is still uploading: the ids the submit needs do not exist yet. */
  readonly waitingForUploads: boolean;
  readonly submitting: boolean;
  readonly failure: string | null;
  readonly onPress: () => void;
}

/**
 * The submit, held while a photo is uploading or a submit is in flight — and
 * saying which, so a greyed button is never a mystery.
 */
export function SubmitBlock({
  label,
  waitingForUploads,
  submitting,
  failure,
  onPress,
}: SubmitBlockProps) {
  const disabled = waitingForUploads || submitting;

  return (
    <View style={styles.submitBlock}>
      <Pressable
        testID="submit-registration"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy: submitting }}
        disabled={disabled}
        onPress={() => {
          // Re-checked here as well as `disabled`: a press queued before the
          // button re-rendered must not submit ids that do not exist yet.
          if (!disabled) onPress();
        }}
        style={({ pressed }) => [
          styles.submit,
          pressed && !disabled && styles.submitPressed,
          disabled && styles.submitDisabled,
        ]}
      >
        <Text style={[styles.submitLabel, disabled && styles.submitLabelDisabled]}>
          {submitting ? 'Submitting…' : label}
        </Text>
      </Pressable>
      {waitingForUploads && !submitting ? (
        <Text style={styles.waiting}>Waiting for your photos to finish uploading.</Text>
      ) : null}
      {failure === null ? null : <FieldError testID="submit-failure" message={failure} />}
    </View>
  );
}

const styles = StyleSheet.create({
  checklist: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkLabel: { flex: 1, fontSize: fontSize.base, color: colors.textSecondary },
  checkLabelOn: { color: colors.text, fontWeight: fontWeight.medium },
  submitBlock: { gap: spacing.sm },
  submit: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  submitPressed: { backgroundColor: colors.primaryDark },
  submitDisabled: { backgroundColor: colors.surfaceTertiary },
  submitLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textInverse },
  submitLabelDisabled: { color: colors.textTertiary },
  waiting: { fontSize: fontSize.xs, color: colors.textTertiary, textAlign: 'center' },
});
