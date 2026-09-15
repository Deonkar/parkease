import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BookingStatus } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

interface BookingStatusChipProps {
  readonly status: BookingStatus;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface Appearance {
  readonly label: string;
  readonly icon: IconName;
  readonly fg: string;
  readonly bg: string;
}

/**
 * Status in words, with an icon, always. Colour is never the only signal
 * (R-FE-12) — a chip that relies on green-versus-grey is unreadable to a
 * deuteranope and invisible to a screen reader.
 *
 * `active` is the only status that earns the availability green, and it earns
 * it for the same reason a free slot does: the car is in the space right now.
 * "Cancelled" is muted rather than red, because a booking the driver cancelled
 * on purpose is not an error being reported back to them.
 */
const APPEARANCE: Readonly<Record<BookingStatus, Appearance>> = {
  pending_payment: {
    label: 'Awaiting payment',
    icon: 'clock-outline',
    fg: colors.surge,
    bg: colors.surgeSoft,
  },
  confirmed: {
    label: 'Confirmed',
    icon: 'check-circle-outline',
    fg: colors.primaryDark,
    bg: colors.primarySoft,
  },
  active: {
    label: 'Parked now',
    icon: 'car-side',
    fg: colors.availableInk,
    bg: colors.availableSoft,
  },
  completed: {
    label: 'Completed',
    icon: 'flag-checkered',
    fg: colors.textSecondary,
    bg: colors.mutedSoft,
  },
  cancelled: {
    label: 'Cancelled',
    icon: 'close-circle-outline',
    fg: colors.textSecondary,
    bg: colors.mutedSoft,
  },
  expired: {
    label: 'Expired',
    icon: 'timer-off-outline',
    fg: colors.textSecondary,
    bg: colors.mutedSoft,
  },
  no_show: {
    label: 'No show',
    icon: 'account-question-outline',
    fg: colors.textSecondary,
    bg: colors.mutedSoft,
  },
};

export function BookingStatusChip({ status }: BookingStatusChipProps) {
  const look = APPEARANCE[status];

  return (
    <View style={[styles.chip, { backgroundColor: look.bg }]}>
      <MaterialCommunityIcons name={look.icon} size={13} color={look.fg} />
      <Text style={[styles.text, { color: look.fg }]}>{look.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
