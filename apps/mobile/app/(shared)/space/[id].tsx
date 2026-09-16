import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { Amenity } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { PhotoCarousel } from '../../../src/features/driver/components/PhotoCarousel';
import { RateCardTable } from '../../../src/features/driver/components/RateCardTable';
import { SlotPill } from '../../../src/features/driver/components/SlotPill';
import { SurgeBanner } from '../../../src/features/driver/components/SurgeBanner';
import { useSpaceDetail } from '../../../src/features/driver/hooks/useBookings';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const AMENITY_ICON: Readonly<Record<string, IconName>> = {
  covered: 'garage-variant',
  cctv: 'cctv',
  guarded: 'shield-check-outline',
  ev_charging: 'ev-station',
  well_lit: 'lightbulb-on-outline',
  wheelchair_accessible: 'wheelchair-accessibility',
  car_wash: 'car-wash',
  valet: 'account-tie-outline',
};

const AMENITY_LABEL: Readonly<Record<string, string>> = {
  covered: 'Covered',
  cctv: 'CCTV',
  guarded: 'Guarded',
  ev_charging: 'EV charging',
  well_lit: 'Well lit',
  wheelchair_accessible: 'Step-free',
  car_wash: 'Car wash',
  valet: 'Valet',
};

export default function SpaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: space, isPending, isError, refetch } = useSpaceDetail(id);

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Space" />
        <SpaceDetailSkeleton />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <ScreenHeader title="Space" />
        <ErrorState
          title="We couldn't load this space"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void refetch()}
        />
      </>
    );
  }

  const defaultBooking = space.defaultBooking;
  const startsAt = defaultBooking === null ? null : new Date(defaultBooking.startsAt);
  const endsAt = defaultBooking === null ? null : new Date(defaultBooking.endsAt);

  return (
    <>
      <ScreenHeader title={space.title} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: spacing['3xl'] }]}
        showsVerticalScrollIndicator={false}
      >
        <PhotoCarousel photos={space.photos} />

        <View style={styles.body}>
          <Text style={styles.title}>{space.title}</Text>
          <Text style={styles.address}>
            {space.landmark === null
              ? space.addressLine
              : `${space.addressLine} · near ${space.landmark}`}
          </Text>

          <View style={styles.ratingRow}>
            <MaterialCommunityIcons name="star" size={15} color={colors.warning} />
            <Text style={styles.rating}>
              {space.rating === null
                ? 'New listing'
                : `${space.rating.toFixed(1)} (${String(space.reviewCount)} reviews)`}
            </Text>
          </View>

          <Section title="Available now">
            <View style={styles.pillRow}>
              {space.totalSlots.car > 0 ? (
                <SlotPill icon="car" count={space.availableNow.car} open={space.isOpenNow} />
              ) : null}
              {space.totalSlots.twoWheeler > 0 ? (
                <SlotPill
                  icon="motorbike"
                  count={space.availableNow.twoWheeler}
                  open={space.isOpenNow}
                />
              ) : null}
            </View>
            <Text style={styles.openLine}>
              {space.schedule.is24x7
                ? 'Open · 24×7'
                : space.isOpenNow
                  ? 'Open right now'
                  : 'Closed right now'}
            </Text>
          </Section>

          {/*
            website.md §2.6: the surge banner sits above pricing, because the
            rate card below it is base rates only. The driver has to meet the
            multiplier before the numbers it applies to, not at Review & Pay.
          */}
          <SurgeBanner
            badge={space.surgeBadge}
            multiplier={space.surgeMultiplier}
            style={styles.surgeBanner}
          />

          {space.pricing.car !== null ? (
            <Section title="Car pricing">
              <RateCardTable card={space.pricing.car} />
            </Section>
          ) : null}

          {space.pricing.twoWheeler !== null ? (
            <Section title="Two-wheeler pricing">
              <RateCardTable card={space.pricing.twoWheeler} />
            </Section>
          ) : null}

          {space.amenities.length > 0 ? (
            <Section title="Amenities">
              <View style={styles.amenityRow}>
                {space.amenities.map((amenity: Amenity) => (
                  <View key={amenity} style={styles.amenity}>
                    <MaterialCommunityIcons
                      name={AMENITY_ICON[amenity] ?? 'check'}
                      size={16}
                      color={colors.primary}
                    />
                    <Text style={styles.amenityText}>{AMENITY_LABEL[amenity] ?? amenity}</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {space.description !== null && space.description.length > 0 ? (
            <Section title="About this space">
              <Text style={styles.prose}>{space.description}</Text>
            </Section>
          ) : null}

          <Section title="Host">
            <Text style={styles.prose}>
              {space.owner.name} · member since{' '}
              {new Date(space.owner.memberSince).getFullYear().toString()}
            </Text>
          </Section>
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        {defaultBooking === null || startsAt === null || endsAt === null ? (
          <Button
            label="Choose a time"
            onPress={() => {
              router.push({ pathname: '/(driver)/book/[spaceId]', params: { spaceId: space.id } });
            }}
          />
        ) : (
          <>
            {/*
              Direction C. The primary action already knows what it is booking
              and what it costs — both decided by the server, because the client
              is not allowed to produce a price (R-FE-06). Two taps for the case
              that is almost always the real one.
            */}
            <Button
              label={`Book ${String(defaultBooking.hours)} hrs · ${formatPaise(defaultBooking.quote.totalPaise, { alwaysDecimals: true })}`}
              onPress={() => {
                router.push({
                  pathname: '/(driver)/book/review',
                  params: {
                    spaceId: space.id,
                    vehicleType: defaultBooking.vehicleType,
                    durationType: defaultBooking.durationType,
                    startsAt: defaultBooking.startsAt,
                    endsAt: defaultBooking.endsAt,
                  },
                });
              }}
            />
            <Text style={styles.dockWindow}>
              {formatTimeIST(startsAt)} – {formatTimeIST(endsAt)} ·{' '}
              {defaultBooking.vehicleType === 'car' ? 'Car' : 'Two-wheeler'}
            </Text>
            <Pressable
              onPress={() => {
                router.push({
                  pathname: '/(driver)/book/[spaceId]',
                  params: { spaceId: space.id },
                });
              }}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Change time or vehicle"
              hitSlop={8}
            >
              <Text style={styles.secondaryText}>Change time or vehicle</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function SpaceDetailSkeleton() {
  return (
    <View style={styles.screen}>
      <Skeleton width="100%" height={240} borderRadius={0} />
      <View style={styles.body}>
        <Skeleton height={24} width="70%" />
        <Skeleton height={16} width="90%" />
        <Skeleton height={16} width="40%" />
        <View style={{ height: spacing.lg }} />
        <Skeleton width="100%" height={72} />
        <View style={{ height: spacing.md }} />
        <Skeleton width="100%" height={72} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  content: {
    backgroundColor: colors.surfaceSecondary,
  },
  body: {
    gap: spacing.xs,
    padding: spacing.base,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  address: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  rating: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  // Same rhythm as a section heading, so the banner reads as belonging to the
  // pricing block below it rather than floating between two of them.
  surgeBanner: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  openLine: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  amenityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  amenity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  amenityText: {
    fontSize: fontSize.sm,
    color: colors.primaryDark,
  },
  prose: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.relaxed,
  },
  dock: {
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dockWindow: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  secondary: {
    // 48dp: Material's minimum, and this is a real target, not a footnote.
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
});
