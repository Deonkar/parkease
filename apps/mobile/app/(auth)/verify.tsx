import { type SessionResponse } from '@parkease/contracts/public';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button, OtpInput } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, Pressable, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { secureStorage } from '@/lib/secure-storage';
import { uuidv7 } from '@/lib/uuid';

const MAX_ATTEMPTS = 3;
const RESEND_SECONDS = 30;

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
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

  const handleVerify = async (code: string) => {
    setLoading(true);
    setError(null);

    try {
      // ponytail: Firebase stub — when Firebase is configured, this will call
      // confirmOtp() to get a real idToken. For now, use a placeholder flow.
      const idToken = `stub-id-token-${code}`;

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

  const handleResend = () => {
    setResendTimer(RESEND_SECONDS);
    setAttempts(MAX_ATTEMPTS);
    setError(null);
    Alert.alert('OTP Sent', 'A new verification code has been sent.');
  };

  const formattedPhone = phone ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : '+91';

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => {
          router.back();
        }}
        style={styles.backButton}
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

        <OtpInput length={6} onComplete={(code) => void handleVerify(code)} disabled={loading} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.resendContainer}>
          {resendTimer > 0 ? (
            <Text style={styles.resendTimer}>
              Resend OTP in 0:{String(resendTimer).padStart(2, '0')}
            </Text>
          ) : (
            <Pressable
              onPress={handleResend}
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
          onPress={() => {}}
          loading={loading}
          disabled
          accessibilityLabel="Verify OTP"
          style={styles.verifyButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  backButton: {
    marginTop: 60,
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
