import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  colors,
  duration,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { useMutation } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newIntent } from '@/lib/api';
import { formatTimeIST } from '@/lib/format';

import { bookingIdInToken, ownerCheckIn } from '../../src/features/owner/api/check-in';
import { toApiFailure } from '../../src/features/shared/api/errors';
import { ScreenHeader } from '../../src/features/shared/components/ScreenHeader';

/**
 * Ignore repeat frames of the same code for this long. The camera fires many
 * times a second on a code it can see, and without this the owner sends a burst
 * of requests for one scan.
 */
const RESCAN_COOLDOWN_MS = 2500;

export default function OwnerScanScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const [notOurs, setNotOurs] = useState(false);
  const lastScan = useRef<{ token: string; at: number } | null>(null);

  const checkIn = useMutation({
    mutationFn: ({ bookingId, token }: { bookingId: string; token: string }) =>
      ownerCheckIn(bookingId, token, newIntent()),
  });

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      const previous = lastScan.current;
      if (previous?.token === data && now - previous.at < RESCAN_COOLDOWN_MS) return;
      lastScan.current = { token: data, at: now };

      const bookingId = bookingIdInToken(data);
      if (bookingId === null) {
        setNotOurs(true);
        return;
      }

      setNotOurs(false);
      checkIn.mutate({ bookingId, token: data });
    },
    [checkIn],
  );

  if (permission === null) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <>
        <ScreenHeader title="Scan booking QR" />
        <View style={[styles.screen, styles.permissionPane]}>
          <MaterialCommunityIcons name="camera-off-outline" size={40} color={colors.muted} />
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>
            ParkEase uses the camera only to read a driver&rsquo;s booking code when they arrive.
            Nothing is recorded or uploaded.
          </Text>
          <Button
            label={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
            onPress={() => {
              void requestPermission();
            }}
          />
        </View>
      </>
    );
  }

  const result = checkIn.data;
  const failure = checkIn.error === null ? null : toApiFailure(checkIn.error);

  return (
    <>
      <ScreenHeader title="Scan booking QR" />

      <View style={styles.screen}>
        <View style={styles.cameraFrame}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={checkIn.isPending ? undefined : onScanned}
          />
          <View style={styles.reticle} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>

        <Text style={styles.hint}>Point at the driver&rsquo;s QR code</Text>

        <View style={[styles.resultPane, { paddingBottom: insets.bottom + spacing.base }]}>
          {checkIn.isPending ? <Text style={styles.pending}>Checking in…</Text> : null}

          {notOurs ? (
            <Banner
              tone="warn"
              icon="help-circle-outline"
              text="That isn't a ParkEase booking code."
            />
          ) : null}

          {failure === null ? null : (
            <Banner tone="error" icon="alert-circle-outline" text={failure.message} />
          )}

          {result === undefined ? null : (
            <Animated.View
              entering={reduceMotion ? undefined : FadeInUp.duration(duration.base)}
              style={styles.success}
            >
              <View style={styles.successHead}>
                <MaterialCommunityIcons
                  name="check-decagram"
                  size={22}
                  color={colors.availableInk}
                />
                <Text style={styles.successName}>{result.driverName}</Text>
              </View>
              <Text style={styles.successDetail}>
                {result.vehicleNumber ?? 'No plate on file'} · checked in at{' '}
                {formatTimeIST(new Date(result.checkedInAt))}
              </Text>
              <Text style={styles.successDetail}>
                Booked {formatTimeIST(new Date(result.startsAt))} to{' '}
                {formatTimeIST(new Date(result.endsAt))}
              </Text>
              <Button
                label="Done"
                onPress={() => {
                  router.back();
                }}
              />
            </Animated.View>
          )}
        </View>
      </View>
    </>
  );
}

function Banner({
  tone,
  icon,
  text,
}: {
  readonly tone: 'warn' | 'error';
  readonly icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  readonly text: string;
}) {
  const fg = tone === 'warn' ? colors.surge : colors.errorInk;
  const bg = tone === 'warn' ? colors.surgeSoft : colors.errorLight;

  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityLiveRegion="polite">
      <MaterialCommunityIcons name={icon} size={18} color={fg} />
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  cameraFrame: {
    margin: spacing.base,
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.text,
  },
  reticle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    margin: spacing.xl,
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: colors.surface,
  },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  resultPane: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.base,
  },
  pending: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
  },
  bannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  success: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.availableSoft,
  },
  successHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  successName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.availableInk,
  },
  successDetail: {
    fontSize: fontSize.sm,
    color: colors.availableInk,
  },
  permissionPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  permissionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  permissionBody: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.relaxed,
  },
});
