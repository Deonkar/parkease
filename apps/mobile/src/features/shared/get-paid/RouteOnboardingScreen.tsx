import { MaterialCommunityIcons } from '@expo/vector-icons';
import { submitRouteOnboardingSchema } from '@parkease/contracts/shared';
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
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toApiFailure } from '../api/errors';
import { FieldError } from '../components/FieldError';
import { TextField } from '../components/FormFields';
import { ReadableColumn } from '../components/ReadableColumn';
import { ScreenHeader } from '../components/ScreenHeader';
import { resolveScreenState } from '../screen-state';

import {
  type Draft,
  EMPTY_DRAFT,
  phaseOf,
  type Step,
  type StepKey,
  stepComplete,
  stepsFor,
} from './checklist';
import { useRouteOnboarding, useSubmitRouteOnboarding } from './hooks';

export type RoutePayee = 'owner' | 'washer';

const BANNER: Record<RoutePayee, { title: string; body: string }> = {
  owner: {
    title: 'Your spaces are hidden from drivers',
    body: 'Finish these 3 steps so Razorpay can send your share of every booking to your bank.',
  },
  washer: {
    title: "You won't get wash offers yet",
    body: 'Finish these 3 steps so Razorpay can pay you for every wash.',
  },
};

const TITLES: Record<StepKey, string> = {
  details: 'Your details',
  pan: 'PAN',
  bank: 'Bank account',
};

const PROMPTS: Record<StepKey, string> = {
  details: 'As they appear on your PAN',
  pan: 'Needed by Razorpay to verify you',
  bank: 'Where your money lands',
};

/** What a finished step shows under its title: enough to recognise, never the full value. */
function summaryOf(key: StepKey, draft: Draft): string {
  switch (key) {
    case 'details':
      return `${draft.legalName} · ${draft.city}`;
    case 'pan':
      return `${draft.pan.slice(0, 2)}·······${draft.pan.slice(-1)}`;
    case 'bank':
      return `${draft.ifsc.slice(0, 4)} ····${draft.accountNumber.slice(-4)}`;
  }
}

const STEP_FIELDS: Record<StepKey, readonly (keyof Draft)[]> = {
  details: ['legalName', 'email', 'street', 'city', 'state', 'postalCode'],
  pan: ['pan'],
  bank: ['accountNumber', 'ifsc'],
};

/** Field → the contract's own message, for the fields of one step (one schema, R-CON-01). */
function errorsFor(key: StepKey, draft: Draft): Partial<Record<keyof Draft, string>> {
  const result = submitRouteOnboardingSchema.safeParse(draft);
  if (result.success) return {};
  const errors: Partial<Record<keyof Draft, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof Draft;
    if (STEP_FIELDS[key].includes(field)) errors[field] ??= issue.message;
  }
  return errors;
}

/**
 * Owner / washer "Get paid" (task 16b, direction A · Checklist). One route: the checklist hub
 * and each step's form swap in place, so the draft survives moving between steps. Nothing is
 * sent until the last step; then Razorpay reviews and the screen becomes a status page.
 */
export function RouteOnboardingScreen({ payee }: { readonly payee: RoutePayee }) {
  const query = useRouteOnboarding();
  const submit = useSubmitRouteOnboarding();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [open, setOpen] = useState<StepKey | null>(null);
  const [edited, setEdited] = useState<ReadonlySet<StepKey>>(new Set());
  const [showErrors, setShowErrors] = useState(false);

  // A resubmission after needs_clarification starts from the name Razorpay already has.
  const knownName = query.data?.legalName ?? null;
  useEffect(() => {
    if (knownName !== null)
      setDraft((d) => (d.legalName === '' ? { ...d, legalName: knownName } : d));
  }, [knownName]);

  const set = (field: keyof Draft) => (value: string) => {
    const normalised =
      field === 'pan' || field === 'ifsc'
        ? value.toUpperCase().replace(/\s/g, '')
        : field === 'accountNumber' || field === 'postalCode'
          ? value.replace(/\D/g, '')
          : value;
    setDraft((d) => ({ ...d, [field]: normalised }));
  };

  const screen = resolveScreenState({ ...query, data: query.isPending ? undefined : [query.data] });
  if (screen === 'loading') {
    return (
      <View style={styles.root} testID="get-paid-skeleton">
        <ScreenHeader title="Get paid" />
        <View style={styles.skeletons}>
          <Skeleton width="100%" height={layout.skeleton.block} borderRadius={radius.md} />
          <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
        </View>
      </View>
    );
  }
  if (query.isError && query.data === undefined) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Get paid" />
        <ErrorState
          title="Couldn't load your payout setup"
          body="Check your connection and try again."
          onAction={() => void query.refetch()}
        />
      </View>
    );
  }

  const view = query.data ?? null;
  const phase = phaseOf(view);
  const steps = stepsFor(draft, view, edited);

  if (phase !== 'checklist') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Get paid" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <ReadableColumn style={styles.column}>
            <StatusCard
              phase={phase}
              bankLast4={view?.bankLast4 ?? null}
              ifscPrefix={view?.ifscPrefix ?? null}
            />
          </ReadableColumn>
        </ScrollView>
      </View>
    );
  }

  if (open !== null) {
    const errors = showErrors ? errorsFor(open, draft) : {};
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={TITLES[open]}
          onBack={() => {
            setOpen(null);
            setShowErrors(false);
          }}
        />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ReadableColumn style={styles.column}>
            {open === 'details' ? (
              <>
                <TextField
                  id="legalName"
                  label="Name as on your PAN"
                  value={draft.legalName}
                  onChangeText={set('legalName')}
                  error={errors.legalName}
                  autoComplete="name"
                />
                <TextField
                  id="email"
                  label="Email"
                  value={draft.email}
                  onChangeText={set('email')}
                  error={errors.email}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                />
                <TextField
                  id="street"
                  label="Street address"
                  value={draft.street}
                  onChangeText={set('street')}
                  error={errors.street}
                  autoComplete="street-address"
                />
                <TextField
                  id="city"
                  label="City"
                  value={draft.city}
                  onChangeText={set('city')}
                  error={errors.city}
                />
                <TextField
                  id="state"
                  label="State"
                  value={draft.state}
                  onChangeText={set('state')}
                  error={errors.state}
                />
                <TextField
                  id="postalCode"
                  label="PIN code"
                  value={draft.postalCode}
                  onChangeText={set('postalCode')}
                  error={errors.postalCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="postal-code"
                />
              </>
            ) : open === 'pan' ? (
              <TextField
                id="pan"
                label="PAN"
                hint="10 characters, like ABCDE1234F"
                value={draft.pan}
                onChangeText={set('pan')}
                error={errors.pan}
                autoCapitalize="characters"
                maxLength={10}
              />
            ) : (
              <>
                <Text style={styles.note}>
                  The account must be in your name — the same as on your PAN.
                </Text>
                <TextField
                  id="accountNumber"
                  label="Account number"
                  value={draft.accountNumber}
                  onChangeText={set('accountNumber')}
                  error={errors.accountNumber}
                  keyboardType="number-pad"
                  maxLength={18}
                />
                <TextField
                  id="ifsc"
                  label="IFSC"
                  hint="11 characters, on your cheque book or bank app"
                  value={draft.ifsc}
                  onChangeText={set('ifsc')}
                  error={errors.ifsc}
                  autoCapitalize="characters"
                  maxLength={11}
                />
              </>
            )}
            <Button
              label="Save and continue"
              onPress={() => {
                if (!stepComplete(draft, open)) {
                  setShowErrors(true);
                  return;
                }
                setEdited((s) => new Set(s).add(open));
                setShowErrors(false);
                setOpen(null);
              }}
            />
          </ReadableColumn>
        </ScrollView>
      </View>
    );
  }

  const pending = steps.find((s) => s.state !== 'done');
  const needsChange = view?.status === 'needs_clarification';
  const banner = needsChange
    ? {
        title: 'Razorpay needs a change',
        body: 'Fix the step marked below and send your details again.',
      }
    : BANNER[payee];

  return (
    <View style={styles.root}>
      <ScreenHeader title="Get paid" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <ReadableColumn style={styles.column}>
          <View style={styles.banner} accessibilityRole="summary" testID="get-paid-banner">
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.warning} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerTitle}>{banner.title}</Text>
              <Text style={styles.bannerBody}>{banner.body}</Text>
            </View>
          </View>

          <Text style={styles.section} accessibilityRole="header">
            {`SETUP · ${String(steps.filter((s) => s.state === 'done').length)} OF 3 DONE`}
          </Text>
          <View style={styles.card}>
            {steps.map((step, index) => (
              <StepRow
                key={step.key}
                step={step}
                index={index}
                summary={
                  step.state === 'done'
                    ? summaryOf(step.key, draft)
                    : (step.reason ?? PROMPTS[step.key])
                }
                last={index === steps.length - 1}
                onPress={() => {
                  setOpen(step.key);
                }}
              />
            ))}
          </View>

          <Text style={styles.section} accessibilityRole="header">
            HOW YOU GET PAID
          </Text>
          <Explainer
            icon="bank-transfer"
            text={
              payee === 'owner'
                ? 'Each booking pays your share straight to your bank when the driver pays — no weekly wait.'
                : 'Each wash pays your share straight to your bank when the driver pays — no weekly wait.'
            }
          />
          <Explainer icon="clock-outline" text="Your bank shows it about 2 working days later." />
          <Explainer
            icon="lock-outline"
            text="Your PAN and account number go straight to Razorpay. ParkEase never stores them."
          />

          {submit.isError ? (
            <FieldError
              testID="get-paid-submit-error"
              message={toApiFailure(submit.error).message}
            />
          ) : null}
          {pending === undefined ? (
            <Button
              label="Send to Razorpay"
              loading={submit.isPending}
              onPress={() => {
                const form = submitRouteOnboardingSchema.safeParse(draft);
                if (form.success) submit.mutate(form.data);
              }}
            />
          ) : (
            <Button
              label={`Continue with ${TITLES[pending.key]}`}
              onPress={() => {
                setOpen(pending.key);
              }}
            />
          )}
        </ReadableColumn>
      </ScrollView>
    </View>
  );
}

function StepRow({
  step,
  index,
  summary,
  last,
  onPress,
}: {
  readonly step: Step;
  readonly index: number;
  readonly summary: string;
  readonly last: boolean;
  readonly onPress: () => void;
}) {
  const stateWord =
    step.state === 'done' ? 'done' : step.state === 'attention' ? 'needs a change' : 'to do';
  return (
    <Pressable
      testID={`step-${step.key}`}
      accessibilityRole="button"
      accessibilityLabel={`Step ${String(index + 1)}, ${TITLES[step.key]}, ${stateWord}. ${summary}`}
      onPress={onPress}
      android_ripple={{ color: colors.surfaceTertiary }}
      style={[styles.step, !last && styles.stepDivider]}
    >
      <View
        style={[
          styles.marker,
          step.state === 'done' && styles.markerDone,
          step.state === 'next' && styles.markerNext,
          step.state === 'attention' && styles.markerAttention,
        ]}
      >
        {step.state === 'done' ? (
          <MaterialCommunityIcons name="check" size={16} color={colors.textInverse} />
        ) : step.state === 'attention' ? (
          <MaterialCommunityIcons name="exclamation" size={16} color={colors.warning} />
        ) : (
          <Text style={[styles.markerText, step.state === 'next' && styles.markerTextNext]}>
            {String(index + 1)}
          </Text>
        )}
      </View>
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{TITLES[step.key]}</Text>
        <Text
          style={[styles.stepSummary, step.state === 'attention' && styles.stepSummaryAttention]}
        >
          {summary}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

function Explainer({
  icon,
  text,
}: {
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly text: string;
}) {
  return (
    <View style={styles.explainer}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <Text style={styles.explainerText}>{text}</Text>
    </View>
  );
}

function StatusCard({
  phase,
  bankLast4,
  ifscPrefix,
}: {
  readonly phase: 'reviewing' | 'active' | 'blocked';
  readonly bankLast4: string | null;
  readonly ifscPrefix: string | null;
}) {
  const bank = bankLast4 === null ? 'your bank' : `${ifscPrefix ?? ''} ····${bankLast4}`.trim();
  const copy = {
    reviewing: {
      icon: 'timer-sand' as const,
      title: 'Razorpay is checking your details',
      body: `We'll tell you as soon as it's done. Money will go to ${bank}.`,
    },
    active: {
      icon: 'check-circle-outline' as const,
      title: "You're set up to get paid",
      body: `Each payment sends your share to ${bank}. Your bank shows it about 2 working days later.`,
    },
    blocked: {
      icon: 'alert-octagon-outline' as const,
      title: "Razorpay couldn't verify your account",
      body: 'Contact ParkEase support and we will sort it out with Razorpay.',
    },
  }[phase];
  return (
    <View style={styles.status} testID={`get-paid-${phase}`}>
      <MaterialCommunityIcons
        name={copy.icon}
        size={32}
        color={phase === 'blocked' ? colors.errorInk : colors.primary}
      />
      <Text style={styles.statusTitle} accessibilityRole="header">
        {copy.title}
      </Text>
      <Text style={styles.statusBody}>{copy.body}</Text>
      <Button
        label="Done"
        variant="secondary"
        onPress={() => {
          router.back();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  skeletons: { padding: spacing.base, gap: spacing.md },
  scroll: { paddingVertical: spacing.base },
  column: { paddingHorizontal: spacing.base, gap: spacing.base },
  banner: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningLight,
  },
  bannerText: { flex: 1, gap: spacing.xs },
  bannerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  bannerBody: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  section: {
    marginTop: spacing.sm,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  step: {
    minHeight: touchTarget + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  stepDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  marker: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  markerNext: { borderColor: colors.primary },
  markerAttention: { borderColor: colors.warning, backgroundColor: colors.warningLight },
  markerText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textTertiary },
  markerTextNext: { color: colors.primary },
  stepText: { flex: 1, gap: spacing.xs / 2 },
  stepTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  stepSummary: { fontSize: fontSize.sm, color: colors.textSecondary },
  stepSummaryAttention: { color: colors.warning },
  explainer: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  explainerText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  note: { fontSize: fontSize.sm, color: colors.textSecondary },
  status: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  statusBody: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
