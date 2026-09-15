import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface BookingQrProps {
  readonly token: string;
  readonly size?: number;
}

const DEFAULT_SIZE = 200;

/**
 * The booking reference, rendered locally.
 *
 * This is an SVG drawn on device from a string the API already returned — never
 * an `<Image>` pointed at an endpoint. Most listed spaces are basements, and a
 * QR that needs a network round trip to appear is a QR that fails at exactly the
 * moment it is needed (R-FE-11). It works in airplane mode, and the Maestro
 * flow asserts that.
 *
 * Quiet zone and a white plate are not decoration: a code rendered edge-to-edge
 * on a tinted surface is measurably harder for a scanner to lock onto.
 */
export function BookingQr({ token, size = DEFAULT_SIZE }: BookingQrProps) {
  return (
    <View style={styles.wrapper}>
      <View
        style={styles.plate}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Your booking QR code. Show this to the space owner to check in."
      >
        <QRCode
          value={token}
          size={size}
          color={colors.text}
          backgroundColor={colors.surface}
          // Medium recovery: enough to survive a fingerprint or a screen glare
          // spot without inflating the module count past what a cracked phone
          // camera can resolve in low light.
          ecl="M"
        />
      </View>
      <Text style={styles.caption}>Show this to the space owner</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: spacing.md,
  },
  plate: {
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  caption: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
