import { type RouteOnboardingView, submitRouteOnboardingSchema } from '@parkease/contracts/shared';

/**
 * The owner / washer "Get paid" checklist (task 16b, direction A · Checklist), as pure data so
 * the screen only renders it. Each step is judged by the contract's own schema (one schema,
 * four consumers): a step is done exactly when the API would accept its fields.
 */
export type Draft = Record<
  | 'legalName'
  | 'email'
  | 'street'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'pan'
  | 'accountNumber'
  | 'ifsc',
  string
>;

export const EMPTY_DRAFT: Draft = {
  legalName: '',
  email: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  pan: '',
  accountNumber: '',
  ifsc: '',
};

export type StepKey = 'details' | 'pan' | 'bank';
export type StepState = 'done' | 'next' | 'todo' | 'attention';

export interface Step {
  readonly key: StepKey;
  readonly state: StepState;
  /** Why Razorpay asked about this step, in words, when `state` is `attention`. */
  readonly reason?: string;
}

const FIELDS: Record<StepKey, readonly (keyof Draft)[]> = {
  details: ['legalName', 'email', 'street', 'city', 'state', 'postalCode'],
  pan: ['pan'],
  bank: ['accountNumber', 'ifsc'],
};

const STEP_SCHEMAS = {
  details: submitRouteOnboardingSchema.pick({
    legalName: true,
    email: true,
    street: true,
    city: true,
    state: true,
    postalCode: true,
  }),
  pan: submitRouteOnboardingSchema.pick({ pan: true }),
  bank: submitRouteOnboardingSchema.pick({ accountNumber: true, ifsc: true }),
} as const;

const pick = (draft: Draft, key: StepKey) =>
  Object.fromEntries(FIELDS[key].map((field) => [field, draft[field]]));

export const stepComplete = (draft: Draft, key: StepKey): boolean =>
  STEP_SCHEMAS[key].safeParse(pick(draft, key)).success;

export type Phase = 'checklist' | 'reviewing' | 'active' | 'blocked';

export function phaseOf(view: RouteOnboardingView | null): Phase {
  switch (view?.status) {
    case undefined:
    case 'pending':
    case 'needs_clarification':
      return 'checklist';
    case 'under_review':
      return 'reviewing';
    case 'activated':
      return 'active';
    case 'rejected':
    case 'suspended':
      return 'blocked';
  }
}

/** Which step edits the field Razorpay named (`requirements[].field_reference`). */
export function stepForField(field: string): StepKey {
  if (/pan|kyc/i.test(field)) return 'pan';
  if (/settlement|account_number|ifsc|beneficiary|bank/i.test(field)) return 'bank';
  return 'details';
}

/** Razorpay's reason codes in plain words; anything unknown still says where to look. */
const REASONS: Record<string, string> = {
  document_invalid: "Razorpay couldn't verify this PAN. Check it matches your card.",
  field_mismatch: 'This must match the name on your PAN and your bank account.',
  invalid_value: 'Razorpay says this looks wrong. Check it and send again.',
};

const reasonFor = (key: StepKey, code: string): string =>
  REASONS[code] ??
  (key === 'pan'
    ? 'Razorpay needs your PAN checked.'
    : key === 'bank'
      ? 'Razorpay needs your bank details checked.'
      : 'Razorpay needs these details checked.');

/**
 * `edited` is the steps the user has changed since Razorpay asked: an amber step goes back to
 * its ordinary state once it has been touched, so the user can see what is left.
 */
export function stepsFor(
  draft: Draft,
  view: RouteOnboardingView | null,
  edited: ReadonlySet<StepKey>,
): Step[] {
  const asked = new Map<StepKey, string>();
  for (const requirement of view?.requirements ?? []) {
    const key = stepForField(requirement.field);
    if (!asked.has(key)) asked.set(key, reasonFor(key, requirement.reason));
  }

  let nextGiven = false;
  return (['details', 'pan', 'bank'] as const).map((key): Step => {
    const reason = asked.get(key);
    if (reason !== undefined && !edited.has(key)) return { key, state: 'attention', reason };
    if (stepComplete(draft, key)) return { key, state: 'done' };
    if (nextGiven) return { key, state: 'todo' };
    nextGiven = true;
    return { key, state: 'next' };
  });
}
