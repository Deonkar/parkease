import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { FieldError } from './FieldError';

/**
 * Labelled form fields, shared by the washer registration forms and the Get paid
 * forms (task 16b; moved here on that second use, R-ARCH-07).
 *
 * Every field is a block: a visible label (never a placeholder standing in for
 * one), an optional hint, the control, then the error UNDER the control. The
 * block carries `field-<id>`, the control `<id>-control`, the error
 * `<id>-error`, which is how the tests prove where an error lands.
 */

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
  readonly keyboardType?: TextInputProps['keyboardType'];
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
  keyboardType,
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
        {...(keyboardType === undefined ? {} : { keyboardType })}
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

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  hint: {
    fontSize: fontSize.xs,
    lineHeight: fontSize.xs * lineHeight.normal,
    color: colors.textTertiary,
  },
  input: {
    minHeight: touchTarget,
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
});
