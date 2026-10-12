import type { CarwashServiceName } from '@parkease/contracts/enums';
import { vehicleTypeSchema } from '@parkease/contracts/enums';
import { colors, fontSize, lineHeight, spacing } from '@parkease/tokens';
import { Button, ErrorState } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WashServicePicker } from '../../../src/features/driver/components/WashServicePicker';
import { useRequestWash } from '../../../src/features/driver/hooks/useAddons';
import { toApiFailure } from '../../../src/features/shared/api/errors';
import { VEHICLE_LABELS } from '../../../src/features/shared/carwash-labels';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

/**
 * Adding a wash to a parked car (§13.5). The driver picks the service; the
 * vehicle type is the booking's, passed in by the booking screen, because the
 * partner's menu is priced per type.
 */
export default function RequestWashScreen() {
  const params = useLocalSearchParams<{ bookingId: string; vehicleType: string }>();
  const insets = useSafeAreaInsets();
  const request = useRequestWash();
  const [service, setService] = useState<CarwashServiceName | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A route param is outside input like any other (R-VAL-01).
  const vehicle = vehicleTypeSchema.safeParse(params.vehicleType);
  if (!vehicle.success) {
    return (
      <ErrorState
        title="We couldn't open this wash request"
        body="Go back to your booking and try again."
        actionLabel="Back"
        onAction={() => {
          router.back();
        }}
      />
    );
  }

  return (
    <>
      <ScreenHeader title="Add a car wash" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['2xl'] }]}
      >
        <Text style={styles.lead}>
          A wash partner comes to your {VEHICLE_LABELS[vehicle.data]} while it is parked. You see
          the price once a partner takes the job, and pay then.
        </Text>

        <WashServicePicker selected={service} onSelect={setService} />

        {error === null ? null : (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        <Button
          label="Find a wash partner"
          testID="wash-request-submit"
          disabled={service === null}
          loading={request.isPending}
          onPress={() => {
            if (service === null) return;
            setError(null);
            request.mutate(
              { bookingId: params.bookingId, serviceName: service, vehicleType: vehicle.data },
              {
                onSuccess: (job) => {
                  router.replace({ pathname: '/(driver)/wash/[jobId]', params: { jobId: job.id } });
                },
                onError: (cause) => {
                  setError(toApiFailure(cause).message);
                },
              },
            );
          }}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { gap: spacing.md, padding: spacing.base },
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
