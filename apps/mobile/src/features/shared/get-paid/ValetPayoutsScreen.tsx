import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type PayoutView, updateBankDetailsSchema } from '@parkease/contracts/shared';
import {
  colors,
  fontSize,
  fontWeight,
  layout,
  lineHeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDayMonthIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { toApiFailure } from '../api/errors';
import { FieldError } from '../components/FieldError';
import { TextField } from '../components/FormFields';
import { ReadableColumn } from '../components/ReadableColumn';
import { RefreshNotice } from '../components/RefreshNotice';
import { ScreenHeader } from '../components/ScreenHeader';
import { isReauthRequired } from '../reauth/reauth';
import { ReauthStep } from '../reauth/ReauthStep';
import { resolveScreenState } from '../screen-state';

import { useBankDetails, usePayoutSummary, usePayouts, useSaveBankDetails } from './hooks';
import { PayoutRow } from './PayoutRow';

const Separator = () => <View style={styles.separator} />;

/**
 * Valet "Get paid" (task 16b, direction A · Checklist): what Monday's RazorpayX run will pay,
 * the account it goes to, and every payout so far. The amount and date are the server's —
 * the phone formats, it never computes (R-FE-06).
 */
export function ValetPayoutsScreen() {
  const summary = usePayoutSummary();
  const bank = useBankDetails();
  const payouts = usePayouts();
  const [editing, setEditing] = useState(false);
  const rows = useMemo(() => payouts.data?.pages.flatMap((p) => p.data) ?? [], [payouts.data]);

  const screen = resolveScreenState(summary);
  if (
    editing ||
    (bank.isSuccess && bank.data === null && screen === 'ready' && rows.length === 0)
  ) {
    return (
      <BankForm
        firstTime={bank.data === null}
        onDone={() => {
          setEditing(false);
        }}
      />
    );
  }

  if (screen === 'loading' || bank.isPending) {
    return (
      <View style={styles.root} testID="valet-payouts-skeleton">
        <ScreenHeader title="Get paid" />
        <View style={styles.skeletons}>
          <Skeleton width="100%" height={layout.skeleton.block} borderRadius={radius.md} />
          <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
        </View>
      </View>
    );
  }
  if (screen === 'error' || summary.data === undefined) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Get paid" />
        <ErrorState
          title="Couldn't load your payouts"
          body="Check your connection and try again."
          onAction={() => void summary.refetch()}
        />
      </View>
    );
  }

  const s = summary.data;
  const nextOn = formatDayMonthIST(new Date(`${s.nextPayoutOn}T00:00:00+05:30`), { weekday: true });
  const belowMinimum = s.balancePaise < s.minimumPaise;
  const last4 = bank.data?.accountNumberLast4 ?? null;

  const header = (
    <View style={styles.header}>
      {summary.isError ? (
        <RefreshNotice
          testID="payouts-refresh-notice"
          retryLabel="Refresh your payouts"
          onRetry={() => void summary.refetch()}
        />
      ) : null}
      <View style={styles.hero} testID="payout-hero">
        <Text style={styles.heroLabel}>{`Next payout · ${nextOn}`}</Text>
        <Text style={styles.heroAmount} testID="payout-hero-amount">
          {formatPaise(s.balancePaise, { alwaysDecimals: true })}
        </Text>
        <Text style={styles.heroNote}>
          {belowMinimum
            ? `Pays once you have ${formatPaise(s.minimumPaise)} or more. Until then it waits for the next Monday.`
            : "Everything you're owed goes to your bank on Monday morning."}
        </Text>
      </View>

      {bank.isError && bank.data === undefined ? (
        // Not "Add your bank account": a failed read is not an empty one, and offering to add
        // would invite a valet who has a bank on file to overwrite it (R-FAIL-01).
        <Pressable
          testID="bank-retry"
          accessibilityRole="button"
          onPress={() => void bank.refetch()}
          android_ripple={{ color: colors.surfaceTertiary }}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Couldn&apos;t load your bank account. Tap to retry.</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="bank-row"
          accessibilityRole="button"
          accessibilityLabel={
            last4 === null ? 'Add your bank account' : `Bank account ending ${last4}. Change`
          }
          onPress={() => {
            setEditing(true);
          }}
          android_ripple={{ color: colors.surfaceTertiary }}
          style={styles.bankRow}
        >
          <MaterialCommunityIcons name="bank-outline" size={22} color={colors.primary} />
          <View style={styles.bankText}>
            <Text style={styles.bankTitle}>
              {last4 === null
                ? 'Add your bank account'
                : `${bank.data?.ifscPrefix ?? ''} ····${last4}`}
            </Text>
            {bank.data == null ? (
              <Text style={styles.bankSub}>Payouts wait until you add one</Text>
            ) : bank.data.payoutsHeldUntil === null ? (
              <Text style={styles.bankSub}>{bank.data.accountHolderName}</Text>
            ) : (
              // A recent change holds payouts to the new account (S-100); say until when.
              <Text style={styles.bankSub} testID="bank-hold">
                {bank.data.accountHolderName} · first payout here after{' '}
                {formatDayMonthIST(new Date(bank.data.payoutsHeldUntil))}
              </Text>
            )}
          </View>
          <Text style={styles.bankAction}>{last4 === null ? 'Add' : 'Change'}</Text>
        </Pressable>
      )}

      {rows.length > 0 ? (
        <Text style={styles.section} accessibilityRole="header">
          PAYOUTS
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Get paid" />
      <ReadableColumn style={styles.body}>
        <FlashList<PayoutView>
          data={rows}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.rowCard}>
              <PayoutRow payout={item} />
            </View>
          )}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={header}
          ListFooterComponent={
            payouts.isFetchNextPageError ? (
              <Pressable
                testID="payouts-more-retry"
                accessibilityRole="button"
                onPress={() => void payouts.fetchNextPage()}
                android_ripple={{ color: colors.surfaceTertiary }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Couldn&apos;t load more. Tap to retry.</Text>
              </Pressable>
            ) : null
          }
          contentContainerStyle={styles.list}
          onEndReached={() => {
            // Not after a failed page: the footer's "Tap to retry" owns that, or a scroll loops it.
            if (payouts.hasNextPage && !payouts.isFetchingNextPage && !payouts.isFetchNextPageError)
              void payouts.fetchNextPage();
          }}
          ListEmptyComponent={
            payouts.isError ? (
              <ErrorState
                title="Couldn't load your payouts"
                body="Check your connection and try again."
                onAction={() => void payouts.refetch()}
              />
            ) : payouts.isPending ? (
              <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
            ) : (
              <View style={styles.empty} testID="payouts-empty">
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name="calendar-clock"
                  size={40}
                  color={colors.textTertiary}
                />
                <Text style={styles.emptyTitle}>No payouts yet</Text>
                <Text style={styles.emptyBody}>
                  Your first one goes out on the Monday after you earn {formatPaise(s.minimumPaise)}
                  .
                </Text>
              </View>
            )
          }
        />
      </ReadableColumn>
    </View>
  );
}

function BankForm({
  firstTime,
  onDone,
}: {
  readonly firstTime: boolean;
  readonly onDone: () => void;
}) {
  const save = useSaveBankDetails();
  const [holder, setHolder] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  // Step two: the fresh OTP the server needs before where money goes can change (S-100).
  const [confirming, setConfirming] = useState(false);
  const [reauthNotice, setReauthNotice] = useState<string | null>(null);
  // A new round remounts the OTP step, so a refused token starts the code flow over.
  const [reauthRound, setReauthRound] = useState(0);

  const parsed = bankFieldsSchema.safeParse({
    accountHolderName: holder,
    accountNumber: account,
    ifscCode: ifsc,
  });
  const errors: Record<string, string> = {};
  if (showErrors && !parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }

  const submit = (reauthToken: string) => {
    if (!parsed.success) return;
    save.mutate(
      { ...parsed.data, reauthToken },
      {
        onSuccess: onDone,
        onError: (error) => {
          // The token was stale or already used: ask for a new code rather than show a dead end.
          if (isReauthRequired(error)) {
            setReauthNotice('That confirmation expired. Send a new code to continue.');
            setReauthRound((round) => round + 1);
          }
        },
      },
    );
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Bank account" {...(firstTime ? {} : { onBack: onDone })} />
      <KeyboardAvoidingView style={styles.root} behavior="height">
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ReadableColumn style={styles.column}>
            {confirming ? (
              <>
                <ReauthStep key={reauthRound} onToken={submit} notice={reauthNotice} />
                {save.isError && !isReauthRequired(save.error) ? (
                  <FieldError testID="bank-save-error" message={toApiFailure(save.error).message} />
                ) : null}
                <Button
                  label="Back to the form"
                  variant="secondary"
                  disabled={save.isPending}
                  onPress={() => {
                    setConfirming(false);
                  }}
                />
              </>
            ) : (
              <>
                <Text style={styles.note}>
                  Your payouts go here every Monday. The account number is encrypted and only ever
                  shown as its last 4 digits.
                </Text>
                <TextField
                  id="accountHolderName"
                  label="Account holder name"
                  value={holder}
                  onChangeText={setHolder}
                  error={errors.accountHolderName}
                  autoComplete="name"
                />
                <TextField
                  id="accountNumber"
                  label="Account number"
                  value={account}
                  onChangeText={(v) => {
                    setAccount(v.replace(/\D/g, ''));
                  }}
                  error={errors.accountNumber}
                  keyboardType="number-pad"
                  maxLength={18}
                />
                <TextField
                  id="ifscCode"
                  label="IFSC"
                  hint="11 characters, on your cheque book or bank app"
                  value={ifsc}
                  onChangeText={(v) => {
                    setIfsc(v.toUpperCase().replace(/\s/g, ''));
                  }}
                  error={errors.ifscCode}
                  autoCapitalize="characters"
                  maxLength={11}
                />
                {firstTime ? null : (
                  <View style={styles.warning} testID="bank-change-warning">
                    <MaterialCommunityIcons
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      name="alert-outline"
                      size={20}
                      color={colors.warning}
                    />
                    <Text style={styles.warningText}>
                      Changing your bank cancels any payout not yet sent, and the first payout to
                      the new account waits 48 hours. We&apos;ll notify you either way.
                    </Text>
                  </View>
                )}
                <Button
                  label="Continue"
                  onPress={() => {
                    if (!parsed.success) {
                      setShowErrors(true);
                      return;
                    }
                    setReauthNotice(null);
                    setConfirming(true);
                  }}
                />
              </>
            )}
          </ReadableColumn>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The fields the person types; the step-up token is added once they confirm. */
const bankFieldsSchema = updateBankDetailsSchema.omit({ reauthToken: true });

const styles = StyleSheet.create({
  retry: {
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
  },
  retryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.warning },
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  body: { flex: 1 },
  skeletons: { padding: spacing.base, gap: spacing.md },
  scroll: { paddingVertical: spacing.base },
  column: { paddingHorizontal: spacing.base, gap: spacing.base },
  list: { paddingTop: spacing.base, paddingBottom: spacing.xl },
  header: { gap: spacing.md, paddingHorizontal: spacing.base, marginBottom: spacing.md },
  hero: {
    gap: spacing.xs,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heroLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  heroAmount: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  heroNote: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  bankRow: {
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
  bankText: { flex: 1, gap: spacing.xs / 2 },
  bankTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  bankSub: { fontSize: fontSize.sm, color: colors.textSecondary },
  bankAction: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  section: {
    marginTop: spacing.sm,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  rowCard: {
    marginHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  separator: { height: spacing.sm },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  note: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
  },
  warningText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.text,
  },
});
