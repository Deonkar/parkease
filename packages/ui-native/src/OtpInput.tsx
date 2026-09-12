import { colors, fontSize, spacing } from '@parkease/tokens';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface OtpInputProps {
  readonly length?: number;
  readonly onComplete: (code: string) => void;
  readonly disabled?: boolean;
}

export function OtpInput({ length = 6, onComplete, disabled = false }: OtpInputProps) {
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, length);
    setCode(cleaned);
    if (cleaned.length === length) {
      onComplete(cleaned);
    }
  };

  const handlePress = () => {
    inputRef.current?.focus();
  };

  return (
    <View>
      <Pressable onPress={handlePress} style={styles.boxContainer} accessibilityRole="none">
        {Array.from({ length }, (_, i) => {
          const char = code[i] ?? '';
          const isFocused = i === code.length && !disabled;

          return (
            <View
              key={i}
              style={[styles.box, isFocused && styles.boxFocused, char !== '' && styles.boxFilled]}
            >
              <Text style={styles.boxText}>{char}</Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={length}
        editable={!disabled}
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        textContentType="oneTimeCode"
        style={styles.hiddenInput}
        accessibilityLabel="Enter verification code"
        accessibilityRole="text"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  boxContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  box: {
    width: 48,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  boxFocused: {
    borderColor: colors.borderFocused,
  },
  boxFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSecondary,
  },
  boxText: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.text,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
    width: 0,
  },
});
