import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestOtp } from '@/lib/firebase';

export default function PhoneScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const isValid = /^\d{10}$/.test(phone);

  const handleSend = async () => {
    if (!isValid) return;

    setLoading(true);
    setError(null);

    try {
      await requestOtp(`+91${phone}`);
      router.push({
        pathname: '/(auth)/verify',
        params: { phone },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = (type: 'terms' | 'privacy') => {
    const label = type === 'terms' ? 'Terms of Service' : 'Privacy Policy';
    Alert.alert(label, `${label} will be available at parkease.in/${type}. Coming soon.`);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {router.canGoBack() && (
        <Pressable
          onPress={() => {
            router.back();
          }}
          style={[styles.backButton, { marginTop: insets.top }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>{'←'}</Text>
        </Pressable>
      )}

      <View style={styles.content}>
        <Text style={styles.title}>Welcome to ParkEase</Text>
        <Text style={styles.subtitle}>Enter your phone number to continue</Text>

        <View style={styles.inputContainer}>
          <View style={styles.countryCode}>
            <Text style={styles.flag}>{'\u{1F1EE}\u{1F1F3}'}</Text>
            <Text style={styles.code}>+91</Text>
          </View>
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={(text) => {
              setPhone(text.replace(/\D/g, '').slice(0, 10));
            }}
            placeholder="98765 43210"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            maxLength={10}
            autoFocus
            accessibilityLabel="Phone number"
            accessibilityHint="Enter your 10-digit mobile number"
          />
        </View>

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.hint}>Please enter a valid 10-digit mobile number</Text>
        )}

        <Button
          label="Send OTP"
          onPress={() => void handleSend()}
          disabled={!isValid}
          loading={loading}
          accessibilityLabel="Send OTP"
          style={styles.button}
        />
      </View>

      <Text style={styles.terms}>
        By continuing, you agree to our{' '}
        <Text
          style={styles.link}
          onPress={() => {
            handleLink('terms');
          }}
          accessibilityRole="link"
        >
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          style={styles.link}
          onPress={() => {
            handleLink('privacy');
          }}
          accessibilityRole="link"
        >
          Privacy Policy
        </Text>
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  backButton: {
    marginLeft: spacing.base,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    fontSize: fontSize['2xl'],
    color: colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    marginBottom: spacing['2xl'],
  },
  inputContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    gap: spacing.xs,
  },
  flag: {
    fontSize: fontSize.lg,
  },
  code: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.text,
  },
  phoneInput: {
    flex: 1,
    fontSize: fontSize.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    color: colors.text,
    minHeight: 52,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
    marginBottom: spacing.xl,
  },
  error: {
    fontSize: fontSize.sm,
    color: colors.error,
    marginBottom: spacing.xl,
  },
  button: {
    width: '100%',
  },
  terms: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    lineHeight: fontSize.sm * 1.6,
  },
  link: {
    color: colors.primary,
    fontWeight: '500',
  },
});
