import { colors, fontSize, lineHeight, spacing } from '@parkease/tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { MeetingPointForm } from '../../../src/features/driver/components/MeetingPointForm';
import { useRequestValet } from '../../../src/features/driver/hooks/useAddons';
import { toApiFailure } from '../../../src/features/shared/api/errors';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

/**
 * Asking for a valet on a booking (§11.10). The driver says where to meet; the
 * server finds the valets, measures the leg and prices it. Nothing here is a
 * price (R-FE-06).
 */
export default function RequestValetScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const request = useRequestValet(bookingId);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ScreenHeader title="Request a valet" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            A valet meets you, drives your car to your space and parks it. When you want it back,
            ask from the valet screen and they bring it to you.
          </Text>

          <MeetingPointForm
            addressLabel="Where should the valet meet you?"
            submitLabel="Request a valet"
            submitTestID="valet-request-submit"
            submitting={request.isPending}
            onSubmit={(pickup) => {
              setError(null);
              request.mutate(pickup, {
                onSuccess: (job) => {
                  router.replace({
                    pathname: '/(driver)/valet/[jobId]',
                    params: { jobId: job.id },
                  });
                },
                onError: (cause) => {
                  // The server's own copy: "Pay for your booking first" and "A
                  // valet is already on the way" each say what to do next.
                  setError(toApiFailure(cause).message);
                },
              });
            }}
          />

          {error === null ? null : (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { gap: spacing.md, padding: spacing.base, paddingBottom: spacing['2xl'] },
  lead: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  error: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
});
