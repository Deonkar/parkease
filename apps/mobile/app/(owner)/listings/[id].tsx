import { ApprovalStatus } from '@parkease/contracts/enums';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button, ErrorState, ListSkeleton } from '@parkease/ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSpaceDetail } from '@/features/owner/hooks/useSpaceDetail';
import { useToggleSpace } from '@/features/owner/hooks/useToggleSpace';
import { formatPaise } from '@/lib/money';

const STATUS_DISPLAY: Record<string, { label: string; color: string; glyph: string }> = {
  active: { label: 'Active', color: colors.success, glyph: '✓' },
  pending_approval: { label: 'Pending Approval', color: colors.warning, glyph: '◷' },
  inactive: { label: 'Inactive', color: colors.textTertiary, glyph: '⊘' },
  changes_requested: { label: 'Changes Requested', color: colors.warning, glyph: '△' },
  rejected: { label: 'Not Approved', color: colors.error, glyph: '✕' },
};

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: space, isLoading, isError, refetch } = useSpaceDetail(id);
  const toggle = useToggleSpace(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Listing' }} />
        <ListSkeleton count={4} itemHeight={60} />
      </SafeAreaView>
    );
  }

  if (isError || !space) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Listing' }} />
        <ErrorState
          title="Could not load listing"
          body="Check your connection and try again."
          onAction={() => {
            void refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  const fallbackStatus = { label: 'Unknown', color: colors.textTertiary, glyph: '?' };
  const status = STATUS_DISPLAY[space.approvalStatus] ?? fallbackStatus;
  const canToggle =
    space.approvalStatus === ApprovalStatus.ACTIVE ||
    space.approvalStatus === ApprovalStatus.INACTIVE;

  function handleToggle() {
    if (!space) return;
    const action = space.approvalStatus === ApprovalStatus.ACTIVE ? 'deactivate' : 'activate';
    Alert.alert(
      `${action.charAt(0).toUpperCase()}${action.slice(1)} listing?`,
      action === 'deactivate'
        ? 'Your listing will be hidden from search. Existing bookings will be honoured.'
        : 'Your listing will be visible in search again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            toggle.mutate();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: space.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        {space.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
            {space.photos.map((photo) => (
              <Image
                key={photo.publicId}
                source={{ uri: photo.url }}
                style={styles.photo}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.noPhotos}>
            <Text style={styles.noPhotosText}>No photos yet</Text>
          </View>
        )}

        <View style={styles.statusBadge}>
          <Text style={[styles.statusText, { color: status.color }]}>
            {status.glyph} {status.label}
          </Text>
        </View>

        {space.rejectionReason ? (
          <View style={styles.rejectionBox}>
            <Text style={styles.rejectionLabel}>Reason:</Text>
            <Text style={styles.rejectionText}>{space.rejectionReason}</Text>
          </View>
        ) : null}

        <Section title="Address">
          <Text style={styles.value}>{space.addressLine}</Text>
          {space.landmark ? <Text style={styles.subvalue}>{space.landmark}</Text> : null}
          <Text style={styles.subvalue}>
            {space.city} — {space.pincode}
          </Text>
        </Section>

        <Section title="Slots">
          <View style={styles.slotRow}>
            {space.slots.car > 0 && <Text style={styles.value}>{String(space.slots.car)} car</Text>}
            {space.slots.twoWheeler > 0 && (
              <Text style={styles.value}>{String(space.slots.twoWheeler)} two-wheeler</Text>
            )}
          </View>
        </Section>

        <Section title="Pricing">
          {space.pricing.car ? (
            <Text style={styles.value}>
              Car: {formatPaise(space.pricing.car.hourlyPaise)}/hr
              {space.pricing.car.dailyPaise
                ? ` · ${formatPaise(space.pricing.car.dailyPaise)}/day`
                : ''}
            </Text>
          ) : null}
          {space.pricing.twoWheeler ? (
            <Text style={styles.value}>
              Two-wheeler: {formatPaise(space.pricing.twoWheeler.hourlyPaise)}/hr
              {space.pricing.twoWheeler.dailyPaise
                ? ` · ${formatPaise(space.pricing.twoWheeler.dailyPaise)}/day`
                : ''}
            </Text>
          ) : null}
        </Section>

        <Section title="Schedule">
          <Text style={styles.value}>
            {space.schedule.is24x7 ? 'Available 24/7' : 'Custom hours'}
          </Text>
        </Section>

        {space.amenities.length > 0 && (
          <Section title="Amenities">
            <View style={styles.amenityList}>
              {space.amenities.map((a) => (
                <View key={a} style={styles.amenityTag}>
                  <Text style={styles.amenityTagText}>{a.replace('_', ' ')}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {space.accessInstructions ? (
          <Section title="Access Instructions">
            <Text style={styles.value}>{space.accessInstructions}</Text>
          </Section>
        ) : null}

        {canToggle && (
          <View style={styles.actions}>
            <Button
              label={space.approvalStatus === ApprovalStatus.ACTIVE ? 'Deactivate' : 'Activate'}
              variant={space.approvalStatus === ApprovalStatus.ACTIVE ? 'secondary' : 'primary'}
              onPress={handleToggle}
              loading={toggle.isPending}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing['3xl'] },
  photos: { height: 200, marginBottom: spacing.base },
  photo: { width: 280, height: 200, borderRadius: 12, marginLeft: spacing.base },
  noPhotos: {
    height: 160,
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  noPhotosText: { color: colors.textTertiary, fontSize: fontSize.sm },
  statusBadge: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  statusText: { fontSize: fontSize.sm, fontWeight: '700' },
  rejectionBox: {
    marginHorizontal: spacing.base,
    padding: spacing.md,
    backgroundColor: colors.errorLight,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  rejectionLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.error },
  rejectionText: { fontSize: fontSize.sm, color: colors.text, marginTop: 4 },
  section: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  value: { fontSize: fontSize.base, color: colors.text },
  subvalue: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  slotRow: { flexDirection: 'row', gap: spacing.base },
  amenityList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amenityTag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.surfaceTertiary,
  },
  amenityTagText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  actions: { padding: spacing.base, marginTop: spacing.md },
});
