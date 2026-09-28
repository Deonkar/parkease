import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SpaceSummary } from '@parkease/contracts/owner';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { APPROVAL_STATUS_DISPLAY } from '@/features/owner/approval-status';

interface ListingCardProps {
  readonly listing: SpaceSummary;
  readonly onPress: () => void;
  readonly onToggle?: () => void;
}

export function ListingCard({ listing, onPress, onToggle }: ListingCardProps) {
  const status = APPROVAL_STATUS_DISPLAY[listing.approvalStatus];

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.row}>
        {listing.primaryPhoto ? (
          <Image
            source={{ uri: listing.primaryPhoto.url }}
            style={styles.image}
            resizeMode="cover"
            accessibilityLabel={listing.title}
          />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <Text style={styles.placeholderText}>No photo</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {listing.title}
          </Text>
          <Text style={styles.city} numberOfLines={1}>
            {listing.city}
          </Text>
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name={status.icon} size={12} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.slots}>
            {listing.slots.car > 0 ? `${String(listing.slots.car)} car` : ''}
            {listing.slots.car > 0 && listing.slots.twoWheeler > 0 ? '  ·  ' : ''}
            {listing.slots.twoWheeler > 0 ? `${String(listing.slots.twoWheeler)} two-wheeler` : ''}
          </Text>
        </View>
      </View>
      {(listing.approvalStatus === 'active' || listing.approvalStatus === 'inactive') &&
      onToggle ? (
        <View style={styles.actions}>
          <Button
            label={listing.approvalStatus === 'active' ? 'Deactivate' : 'Activate'}
            variant="secondary"
            onPress={onToggle}
            style={styles.actionButton}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  image: {
    width: 72,
    height: 72,
    borderRadius: 8,
  },
  placeholder: {
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
  },
  city: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
    marginTop: 2,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    // The shared map's label is Title Case (`approval-status.ts`, reconciled
    // from listing detail's wording); this card's own all-caps look is kept
    // here rather than duplicating a second, differently-worded copy of it.
    textTransform: 'uppercase',
  },
  slots: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    minHeight: 36,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
  },
});
