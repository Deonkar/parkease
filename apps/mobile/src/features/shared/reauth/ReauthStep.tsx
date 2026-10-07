import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { Button, OtpInput } from '@parkease/ui-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError } from '../components/FieldError';

import { maskPhone, type ReauthDeps, reauthDeps } from './reauth';

type Step =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly phone: string }
  | { readonly kind: 'sending'; readonly phone: string }
  | { readonly kind: 'code'; readonly phone: string }
  | { readonly kind: 'confirming'; readonly phone: string };

/**
 * "Confirm it's you": a fresh OTP on the account's own phone, whose ID token the caller sends with
 * the change (S-100). `notice` carries why it is being asked again (the server refused a token).
 */
export function ReauthStep({
  onToken,
  notice,
  deps = reauthDeps,
}: {
  readonly onToken: (idToken: string) => void;
  readonly notice?: string | null;
  readonly deps?: ReauthDeps;
}) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(notice ?? null);

  useEffect(() => {
    let live = true;
    deps.ownPhone().then(
      (phone) => {
        if (live) setStep({ kind: 'ready', phone });
      },
      () => {
        if (live) setError("Couldn't load your phone number. Check your connection and try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [deps]);

  const send = async (phone: string) => {
    setError(null);
    setStep({ kind: 'sending', phone });
    try {
      await deps.sendCode(phone);
      setStep({ kind: 'code', phone });
    } catch {
      setError("We couldn't send the code. Try again in a moment.");
      setStep({ kind: 'ready', phone });
    }
  };

  const confirm = async (phone: string, code: string) => {
    setError(null);
    setStep({ kind: 'confirming', phone });
    try {
      onToken(await deps.confirmCode(code));
    } catch {
      setError("That code didn't work. Check it and try again.");
      setStep({ kind: 'code', phone });
    }
  };

  const phone = step.kind === 'loading' ? null : step.phone;

  return (
    <View style={styles.root} testID="reauth-step">
      <Text style={styles.title} accessibilityRole="header">
        Confirm it&apos;s you
      </Text>
      <Text style={styles.body}>
        Changing where your money goes needs a code sent to your phone
        {phone === null ? '.' : ` (${maskPhone(phone)}).`}
      </Text>
      {step.kind === 'code' || step.kind === 'confirming' ? (
        <OtpInput
          disabled={step.kind === 'confirming'}
          onComplete={(code) => void confirm(step.phone, code)}
        />
      ) : (
        <Button
          label="Send code"
          loading={step.kind === 'sending' || step.kind === 'loading'}
          disabled={phone === null}
          onPress={() => {
            if (phone !== null) void send(phone);
          }}
        />
      )}
      {error === null ? null : <FieldError testID="reauth-error" message={error} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  body: { fontSize: fontSize.base, color: colors.textSecondary },
});
