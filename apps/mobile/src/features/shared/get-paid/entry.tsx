import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { phaseOf } from './checklist';
import { useRouteOnboarding } from './hooks';
import type { RoutePayee } from './RouteOnboardingScreen';

/** The row on each earnings screen that opens Get paid (task 16b). */
export function GetPaidRow({ href, caption }: { readonly href: Href; readonly caption: string }) {
  return (
    <Pressable
      testID="get-paid-row"
      accessibilityRole="button"
      accessibilityLabel={`Get paid. ${caption}`}
      onPress={() => {
        router.push(href);
      }}
      android_ripple={{ color: colors.surfaceTertiary }}
      style={styles.row}
    >
      <MaterialCommunityIcons name="bank-transfer" size={22} color={colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Get paid</Text>
        <Text style={styles.rowCaption}>{caption}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

const COPY: Record<RoutePayee, { title: string; body: string }> = {
  owner: {
    title: 'Your spaces are hidden from drivers',
    body: 'Set up payouts so Razorpay can pay you, and your spaces go live.',
  },
  washer: {
    title: "You won't get wash offers yet",
    body: 'Set up payouts so Razorpay can pay you for each wash.',
  },
};

/**
 * Shown where not being set up costs the payee something: the owner dashboard (spaces hidden
 * from search) and the washer's offers (no offers). Hidden while loading, once submitted, and on
 * a fetch error — it is a nudge; the Get paid screen itself says what failed.
 */
export function PayoutSetupBanner({
  payee,
  href,
}: {
  readonly payee: RoutePayee;
  readonly href: Href;
}) {
  const query = useRouteOnboarding();
  if (query.data === undefined) return null;
  const phase = phaseOf(query.data);
  if (phase === 'reviewing' || phase === 'active') return null;

  const copy =
    query.data?.status === 'needs_clarification'
      ? {
          title: 'Razorpay needs a change',
          body: 'Fix your payout details so your account can go live.',
        }
      : phase === 'blocked'
        ? { title: "Razorpay couldn't verify you", body: 'Contact support to get paid.' }
        : COPY[payee];

  return (
    <Pressable
      testID="payout-setup-banner"
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. ${copy.body} Set up payouts`}
      onPress={() => {
        router.push(href);
      }}
      style={styles.banner}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.warning} />
      <View style={styles.rowText}>
        <Text style={styles.bannerTitle}>{copy.title}</Text>
        <Text style={styles.bannerBody}>{copy.body}</Text>
        <Text style={styles.bannerAction}>Set up payouts</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget + spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowText: { flex: 1, gap: spacing.xs / 2 },
  rowTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  rowCaption: { fontSize: fontSize.sm, color: colors.textSecondary },
  banner: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningLight,
  },
  bannerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  bannerBody: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  bannerAction: {
    minHeight: touchTarget / 2,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
});
