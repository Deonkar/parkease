import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CARWASH_SERVICE_NAME_VALUES, type CarwashServiceName } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { SERVICE_LABELS } from '../labels';

import { FieldError } from './FieldError';

/**
 * The parts both registration forms are built from (§14.2), so the business
 * and gig forms read as one product.
 *
 * Every field is a block: a visible label (never a placeholder standing in for
 * one), an optional hint, the control, then the error UNDER the control. The
 * block carries `field-<id>`, the control `<id>-control`, the error
 * `<id>-error`, which is how the tests prove where an error lands.
 */

/** Material's minimum touch target. */
const MIN_TARGET = 48;

export interface FieldBlockProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

export function FieldBlock({ id, label, hint, error, children }: FieldBlockProps) {
  return (
    <View style={styles.block} testID={`field-${id}`}>
      <Text style={styles.label}>{label}</Text>
      {hint === undefined ? null : <Text style={styles.hint}>{hint}</Text>}
      {children}
      {error === undefined ? null : <FieldError testID={`${id}-error`} message={error} />}
    </View>
  );
}

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly autoComplete?: TextInputProps['autoComplete'];
  readonly maxLength?: number;
}

export function TextField({
  id,
  label,
  value,
  onChangeText,
  hint,
  error,
  autoCapitalize = 'words',
  autoComplete = 'off',
  maxLength,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <FieldBlock id={id} label={label} {...(hint === undefined ? {} : { hint })} error={error}>
      <TextInput
        testID={`${id}-control`}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        {...(maxLength === undefined ? {} : { maxLength })}
        accessibilityLabel={label}
        {...(error === undefined ? {} : { accessibilityHint: error })}
        style={[
          styles.input,
          focused && styles.inputFocused,
          error !== undefined && styles.inputError,
        ]}
      />
    </FieldBlock>
  );
}

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
  block: { gap: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  hint: {
    fontSize: fontSize.xs,
    lineHeight: fontSize.xs * lineHeight.normal,
    color: colors.textTertiary,
  },
  input: {
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    fontSize: fontSize.base,
    color: colors.text,
  },
  inputFocused: { borderColor: colors.borderFocused },
  inputError: { borderColor: colors.error },
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
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkLabel: { flex: 1, fontSize: fontSize.base, color: colors.textSecondary },
  checkLabelOn: { color: colors.text, fontWeight: fontWeight.medium },
  submitBlock: { gap: spacing.sm },
  submit: {
    minHeight: MIN_TARGET,
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
