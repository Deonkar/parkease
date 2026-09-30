import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import type {
  BankDetailsView,
  PayoutSummaryView,
  PayoutView,
  RouteOnboardingView,
  SubmitRouteOnboarding,
  UpdateBankDetails,
} from '@parkease/contracts/shared';
import { payoutSummaryViewSchema, payoutViewSchema } from '@parkease/contracts/shared';

/**
 * In-memory Get paid state for the dev-mock web preview (`api.ts` serves it only when
 * `__DEV__` and a dev-mock session). Parsed through the real schemas, so a fixture that
 * drifts from the contract fails here, not on screen. A full page reload resets it
 * (learnings: the dev-mock store is in-memory).
 */
let route: RouteOnboardingView | null = null;
let bank: BankDetailsView | null = {
  accountHolderName: 'Ravi Kumar',
  accountNumberLast4: '6789',
  ifscPrefix: 'HDFC',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const PAYOUTS: PayoutView[] = [
  {
    id: '01929b3a-0000-7000-8000-000000000003',
    period: '2026-W40',
    grossPaise: 280_000,
    tcsPaise: 0,
    tdsPaise: 0,
    netPaise: 280_000,
    status: 'processing',
    razorpayPayoutId: 'pout_QK7l1nFirst',
    createdAt: '2026-09-28T00:30:00.000Z',
  },
  {
    id: '01929b3a-0000-7000-8000-000000000002',
    period: '2026-W39',
    grossPaise: 160_000,
    tcsPaise: 0,
    tdsPaise: 0,
    netPaise: 160_000,
    status: 'paid',
    razorpayPayoutId: 'pout_QK7l1nSecnd',
    createdAt: '2026-09-21T00:30:00.000Z',
  },
  {
    id: '01929b3a-0000-7000-8000-000000000001',
    period: '2026-W38',
    grossPaise: 90_000,
    tcsPaise: 0,
    tdsPaise: 0,
    netPaise: 90_000,
    status: 'failed',
    razorpayPayoutId: null,
    createdAt: '2026-09-14T00:30:00.000Z',
  },
].map((p) => payoutViewSchema.parse(p));

export const devGetPaid = {
  route: () => route,
  submitRoute: (form: SubmitRouteOnboarding): RouteOnboardingView => {
    route = {
      status: 'under_review',
      legalName: form.legalName,
      bankLast4: form.accountNumber.slice(-4),
      ifscPrefix: form.ifsc.slice(0, 4),
      requirements: [],
    };
    return route;
  },
  summary: (): PayoutSummaryView =>
    payoutSummaryViewSchema.parse({
      balancePaise: 128_000,
      nextPayoutOn: '2026-10-05',
      minimumPaise: 10_000,
    }),
  payouts: (cursor: string | undefined) => ({
    data: cursor === undefined ? PAYOUTS : [],
    meta: cursorPageMetaSchema.parse({ limit: 20, hasMore: false, nextCursor: null }),
  }),
  bank: () => bank,
  saveBank: (form: UpdateBankDetails): BankDetailsView => {
    bank = {
      accountHolderName: form.accountHolderName,
      accountNumberLast4: form.accountNumber.slice(-4),
      ifscPrefix: form.ifscCode.slice(0, 4),
      updatedAt: new Date().toISOString(),
    };
    return bank;
  },
};
