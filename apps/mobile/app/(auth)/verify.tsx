import { type SessionResponse } from '@parkease/contracts/public';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button, OtpInput } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { markOnboarded } from '@/features/shared/hooks/useHasOnboarded';
import { api } from '@/lib/api';
import { confirmOtp, requestOtp } from '@/lib/firebase';
import { secureStorage } from '@/lib/secure-storage';
import { uuidv7 } from '@/lib/uuid';

const MAX_ATTEMPTS = 3;
const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const auth = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(MAX_ATTEMPTS);
  const [resendTimer, setResendTimer] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setInterval(() => {
      setResendTimer((t) => t - 1);
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [resendTimer]);

  const handleVerify = async (otp: string) => {
    setLoading(true);
    setError(null);

    try {
      const idToken = await confirmOtp(otp);

      if (__DEV__ && idToken.startsWith('dev-mock-token-')) {
        await markOnboarded();
        auth.setAuthenticated([], null);
        router.replace('/(auth)/choose-role');
        return;
      }

      const { data } = await api.post<{ data: SessionResponse }>('/auth/session', { idToken }, {
        _skipAuth: true,
        headers: { 'Idempotency-Key': uuidv7() },
      } as never);

      await secureStorage.write({
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
        roles: [...data.data.roles],
        activeRole: data.data.activeRole,
      });

      await markOnboarded();
      auth.setAuthenticated(data.data.roles, data.data.activeRole);

      if (data.data.isNewUser || data.data.activeRole === null) {
        router.replace('/(auth)/choose-role');
      } else {
        router.replace(`/(${data.data.activeRole})`);
      }
    } catch {
      const remaining = attempts - 1;
      setAttempts(remaining);
      if (remaining <= 0) {
        Alert.alert('Too many attempts', 'Please request a new OTP.');
        router.back();
      } else {
        setError(`Invalid OTP. Please check and try again. (${String(remaining)} left)`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!phone) return;
    setResendTimer(RESEND_SECONDS);
    setAttempts(MAX_ATTEMPTS);
    setError(null);
    setCode('');

    try {
      await requestOtp(`+91${phone}`);
      Alert.alert('OTP Sent', 'A new verification code has been sent.');
    } catch {
      Alert.alert('Error', 'Failed to resend OTP. Please try again.');
    }
  };

  const formattedPhone = phone ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : '+91';
  const canVerify = code.length === OTP_LENGTH && !loading;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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

      <View style={styles.content}>
        <Text style={styles.title}>Verify Your Number</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          {formattedPhone}
        </Text>

        <OtpInput
          length={OTP_LENGTH}
          onComplete={(c) => void handleVerify(c)}
          onChange={setCode}
          disabled={loading}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.resendContainer}>
          {resendTimer > 0 ? (
            <Text style={styles.resendTimer}>
              Resend OTP in 0:{String(resendTimer).padStart(2, '0')}
            </Text>
          ) : (
            <Pressable
              onPress={() => void handleResend()}
              accessibilityRole="button"
              accessibilityLabel="Resend OTP"
              style={styles.resendButton}
            >
              <Text style={styles.resendLink}>Resend OTP</Text>
            </Pressable>
          )}
        </View>

        <Button
          label="Verify"
          onPress={() => void handleVerify(code)}
          loading={loading}
          disabled={!canVerify}
          accessibilityLabel="Verify OTP"
          style={styles.verifyButton}
        />
      </View>
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
    lineHeight: fontSize.base * 1.5,
  },
  error: {
    fontSize: fontSize.sm,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.base,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  resendTimer: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  resendButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resendLink: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  verifyButton: {
    marginTop: spacing['2xl'],
    width: '100%',
  },
});
