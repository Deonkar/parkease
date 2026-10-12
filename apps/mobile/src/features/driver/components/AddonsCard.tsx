import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BookingStatus } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SERVICE_LABELS } from '@/features/shared/carwash-labels';

import {
  VALET_BOOKING_STATUSES,
  VALET_STATUS_COPY,
  valetIsLive,
  WASH_BOOKING_STATUSES,
  WASH_STATUS_COPY,
} from '../addon-copy';
import { useValetJob, useWashJob } from '../hooks/useAddons';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface AddonsCardProps {
  readonly bookingStatus: BookingStatus;
  readonly valetJobId: string | null;
  readonly washJobIds: readonly string[];
  readonly onRequestValet: () => void;
  readonly onOpenValet: (jobId: string) => void;
  readonly onRequestWash: () => void;
  readonly onOpenWash: (jobId: string) => void;
}

const includes = (list: readonly BookingStatus[], status: BookingStatus): boolean =>
  list.includes(status);

/**
 * Valet and car wash, on the booking they belong to.
 *
 * The request buttons appear only in the booking statuses the API accepts
 * (`addon-copy.ts`), so the driver is never offered a request the server will
 * refuse. Jobs already requested are listed with their status in words, and
 * open their own screen. Renders nothing for a booking that has neither.
 */
export function AddonsCard({
  bookingStatus,
  valetJobId,
  washJobIds,
  onRequestValet,
  onOpenValet,
  onRequestWash,
  onOpenWash,
}: AddonsCardProps) {
  const valet = useValetJob(valetJobId);

  // One live valet per booking: the server refuses a second, so the button
  // waits until the last one is finished or cancelled. While the remembered job
  // is still loading the button stays away rather than flickering in.
  const valetFree = valetJobId === null || (valet.data !== undefined && !valetIsLive(valet.data));
  const canRequestValet = includes(VALET_BOOKING_STATUSES, bookingStatus) && valetFree;
  const canRequestWash = includes(WASH_BOOKING_STATUSES, bookingStatus);
  // A confirmed booking will be washable once the car is in; say so rather than
  // leave the driver wondering where the option went.
  const washLater = bookingStatus === 'confirmed';

  if (valetJobId === null && washJobIds.length === 0 && !canRequestValet && !canRequestWash) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        Valet and car wash
      </Text>

      {valetJobId === null ? null : <ValetRow jobId={valetJobId} onOpen={onOpenValet} />}
      {washJobIds.map((id) => (
        <WashRow key={id} jobId={id} onOpen={onOpenWash} />
      ))}

      {canRequestValet ? (
        <ActionRow
          testID="booking-request-valet"
          icon="account-tie-outline"
          label="Request a valet"
          hint="A valet meets you, parks your car here and brings it back."
          onPress={onRequestValet}
        />
      ) : null}
      {canRequestWash ? (
        <ActionRow
          testID="booking-add-wash"
          icon="car-wash"
          label="Add a car wash"
          hint="A partner washes your car while it is parked."
          onPress={onRequestWash}
        />
      ) : washLater ? (
        <Text style={styles.hint}>You can add a car wash once your car is parked.</Text>
      ) : null}
    </View>
  );
}

function ValetRow({ jobId, onOpen }: { jobId: string; onOpen: (id: string) => void }) {
  const { data: job, isError } = useValetJob(jobId);
  const status =
    job === undefined
      ? isError
        ? "Couldn't load the status. Tap to open."
        : 'Loading…'
      : VALET_STATUS_COPY[job.status].label;
  return (
    <JobRow
      testID="booking-valet-job"
      icon="account-tie-outline"
      title="Valet"
      status={status}
      onPress={() => {
        onOpen(jobId);
      }}
    />
  );
}

function WashRow({ jobId, onOpen }: { jobId: string; onOpen: (id: string) => void }) {
  const { data: job, isError } = useWashJob(jobId);
  const title = job === undefined ? 'Car wash' : SERVICE_LABELS[job.serviceName];
  const status =
    job === undefined
      ? isError
        ? "Couldn't load the status. Tap to open."
        : 'Loading…'
      : WASH_STATUS_COPY[job.status].label;
  return (
    <JobRow
      testID={`booking-wash-job-${jobId}`}
      icon="car-wash"
      title={title}
      status={status}
      onPress={() => {
        onOpen(jobId);
      }}
    />
  );
}

function JobRow({
  testID,
  icon,
  title,
  status,
  onPress,
}: {
  icon: IconName;
  title: string;
  status: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${status}. Open details`}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.textSecondary} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowStatus}>{status}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

function ActionRow({
  testID,
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <View style={styles.rowCopy}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.rowStatus}>{hint}</Text>
      </View>
      <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.base,
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heading: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  rowStatus: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: fontSize.xs * lineHeight.normal,
  },
  actionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: fontSize.xs * lineHeight.normal,
  },
});
