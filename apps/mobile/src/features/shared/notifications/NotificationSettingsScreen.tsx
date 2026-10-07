import { type NotificationCategory, type NotificationPreference } from '@parkease/contracts/shared';
import {
  colors,
  fontSize,
  fontWeight,
  layout,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { toApiFailure } from '../api/errors';
import { FieldError } from '../components/FieldError';
import { ReadableColumn } from '../components/ReadableColumn';
import { ScreenHeader } from '../components/ScreenHeader';

import { usePreferences, useUpdatePreference } from './hooks';

const COPY: Record<NotificationCategory, { title: string; detail: string }> = {
  bookings: { title: 'Bookings', detail: 'Confirmations, reminders and cancellations' },
  valet: { title: 'Valet', detail: 'Assignments, arrivals and status updates' },
  carwash: { title: 'Car wash', detail: 'Wash accepted and completed' },
  jobs: { title: 'Job offers', detail: 'New valet and car wash jobs near you' },
  spaces: { title: 'Spaces', detail: 'Listing approvals and requested changes' },
  payouts: { title: 'Payouts', detail: 'Payouts sent, failed or paused' },
  reviews: { title: 'Reviews', detail: 'Review requests and new reviews' },
  account: { title: 'Account', detail: 'Verification, roles and offers on your account' },
  promotions: {
    title: 'Offers and tips',
    detail: 'Occasional news from ParkEase. Off by default.',
  },
};

function PreferenceRow({
  pref,
  onToggle,
}: {
  readonly pref: NotificationPreference;
  readonly onToggle: (category: NotificationCategory, value: boolean) => void;
}) {
  const copy = COPY[pref.category];
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{copy.title}</Text>
        <Text style={styles.rowDetail}>{copy.detail}</Text>
      </View>
      <Switch
        testID={`pref-${pref.category}`}
        accessibilityRole="switch"
        accessibilityLabel={`${copy.title} push notifications`}
        accessibilityState={{ checked: pref.pushEnabled }}
        value={pref.pushEnabled}
        onValueChange={(value) => {
          onToggle(pref.category, value);
        }}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

/**
 * One switch per category, for push. The in-app feed keeps every category: a muted push is still
 * a row in the feed, so nothing important is only ever a banner that was swiped away.
 */
export function NotificationSettingsScreen() {
  const prefs = usePreferences();
  const update = useUpdatePreference();

  if (prefs.isPending) {
    return (
      <View style={styles.root} testID="notification-settings-skeleton">
        <ScreenHeader title="Notification settings" />
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4].map((n) => (
            <Skeleton key={n} width="100%" height={layout.skeleton.row} borderRadius={radius.md} />
          ))}
        </View>
      </View>
    );
  }
  if (prefs.data === undefined) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Notification settings" />
        <ErrorState
          title="Couldn't load your settings"
          body="Check your connection and try again."
          onAction={() => void prefs.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notification settings" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <ReadableColumn style={styles.column}>
          <Text style={styles.intro}>Choose which updates reach you as push notifications.</Text>
          {update.isError ? (
            <FieldError
              testID="pref-save-error"
              message={`${toApiFailure(update.error).message} Your change was undone.`}
            />
          ) : null}
          <View style={styles.card}>
            {prefs.data.map((pref) => (
              <PreferenceRow
                key={pref.category}
                pref={pref}
                onToggle={(category, value) => {
                  update.mutate({ preferences: [{ category, pushEnabled: value }] });
                }}
              />
            ))}
          </View>
        </ReadableColumn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  skeletons: { padding: spacing.base, gap: spacing.sm },
  scroll: { paddingVertical: spacing.base },
  column: { paddingHorizontal: spacing.base, gap: spacing.md },
  intro: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: spacing.xs / 2 },
  rowTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  rowDetail: { fontSize: fontSize.sm, color: colors.textSecondary },
});
