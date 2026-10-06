import { DEFAULT_SURGE_TIERS } from '@parkease/contracts/admin';

/**
 * Dev-only canned responses (VITE_ADMIN_FIXTURES=1), so every screen can be opened and checked
 * without Firebase, a database or an API. Each one is parsed by the same contract schema the real
 * response would be, so a fixture that drifts from the contract fails loudly. Worst cases on
 * purpose (break-ui): long Indian names, amounts in lakhs, a queue of one.
 */
const id = (n: number): string => `0192f1c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const range = { from: '2026-09-08', to: '2026-10-08' };
const kpi = (account: string, side: string) => ({ account, side, ...range });

const ledgerRow = (
  n: number,
  account: string,
  direction: 'debit' | 'credit',
  amountPaise: number,
) => ({
  id: id(900 + n),
  txnId: id(800 + Math.floor(n / 4)),
  account,
  direction,
  amountPaise,
  bookingId: id(500),
  payoutId: null,
  description: 'booking created',
  occurredAt: at(60 * n),
});

const LEDGER = [
  ledgerRow(0, 'driver_receivable', 'debit', 9702),
  ledgerRow(1, 'owner_payable', 'credit', 5100),
  ledgerRow(2, 'platform_revenue', 'credit', 3900),
  ledgerRow(3, 'gst_payable', 'credit', 702),
];

const ACCOUNTS = [
  ['driver_receivable', 45840000, 0, 'dr'],
  ['owner_payable', 30460000, 34560000, 'cr'],
  ['platform_revenue', 0, 6300000, 'cr'],
  ['gst_payable', 0, 1140000, 'cr'],
  ['tcs_payable', 0, 0, null],
  ['tds_payable', 0, 0, null],
  ['gateway_fees', 965000, 0, 'dr'],
  ['refunds_payable', 214000, 214000, null],
  ['promo_expense', 50000, 0, 'dr'],
  ['settlement_clearing', 30460000, 30460000, null],
] as const;

type Fixture = { data: unknown; meta?: Record<string, unknown> };
const page = (items: unknown[]): Fixture => ({
  data: items,
  meta: { page: 1, pageSize: 20, total: items.length },
});
const cursor = (items: unknown[]): Fixture => ({
  data: items,
  meta: { limit: 50, hasMore: false, nextCursor: null },
});

const SPACE = {
  id: id(100),
  title: 'Basement Parking, 5th Cross, Koramangala 4th Block (near Sony World Signal)',
  address: '42, 5th Cross, Koramangala 4th Block, Bengaluru 560034',
  ownerId: id(2),
  ownerName: 'Priyadarshini Venkataraghavan',
  ownerPhone: '+91 99887***43',
  isFirstListing: true,
  approvalStatus: 'pending_approval',
  submittedAt: at(120),
  reviewNotes: null,
};

const GET: [RegExp, () => Fixture][] = [
  [
    /^\/admin\/dashboard/,
    () => ({
      data: {
        ...range,
        grossPaise: 42000000,
        platformRevenuePaise: 6300000,
        ownerPayablePaise: 34560000,
        gstPayablePaise: 1140000,
        queries: {
          gross: kpi('driver_receivable', 'debit'),
          platformRevenue: kpi('platform_revenue', 'credit'),
          ownerPayable: kpi('owner_payable', 'net_credit'),
          gstPayable: kpi('gst_payable', 'credit'),
        },
        bookings: 1284,
        activeSpaces: 412,
        pending: { spaces: 7, partners: 4, reports: 1 },
        ledger: { balanced: true, imbalancedTxnIds: [] },
        series: Array.from({ length: 30 }, (_, n) => ({
          day: new Date(Date.UTC(2026, 8, 8 + n)).toISOString().slice(0, 10),
          grossPaise: 900000 + ((n * 7919) % 11) * 90000,
        })),
      },
    }),
  ],
  [
    /^\/admin\/spaces\/[^/?]+/,
    () => ({
      data: {
        ...SPACE,
        description: 'Covered basement, 2 car slots.',
        photos: [
          'https://picsum.photos/seed/pe1/600/400',
          'https://picsum.photos/seed/pe2/600/400',
        ],
        pricing: { car: { hourlyPaise: 3000, dailyPaise: 20000 } },
        schedule: { is24x7: true },
        amenities: ['covered', 'cctv', 'guarded'],
        latitude: 12.9352,
        longitude: 77.6245,
        zoneId: 'tdr1up',
        reviewedAt: null,
      },
    }),
  ],
  [
    /^\/admin\/spaces/,
    () =>
      page([
        SPACE,
        {
          ...SPACE,
          id: id(101),
          title: 'Stilt Parking, Palm Meadows',
          isFirstListing: false,
          ownerName: 'Arun M.',
          reviewNotes: 'Photo 2 shows a different building.',
          submittedAt: at(20),
        },
      ]),
  ],
  [
    /^\/admin\/users/,
    () =>
      page([
        {
          id: id(1),
          name: 'Ravi Kumar',
          phone: '+91 98765***10',
          status: 'active',
          createdAt: at(80_000),
          roles: [{ role: 'driver', status: 'active', grantedAt: at(80_000) }],
        },
        {
          id: id(2),
          name: 'Priyadarshini Venkataraghavan',
          phone: '+91 99887***43',
          status: 'active',
          createdAt: at(90_000),
          roles: [
            { role: 'driver', status: 'active', grantedAt: at(90_000) },
            { role: 'owner', status: 'active', grantedAt: at(89_000) },
          ],
        },
        {
          id: id(3),
          name: 'Arun M.',
          phone: '+91 90123***77',
          status: 'active',
          createdAt: at(40_000),
          roles: [
            { role: 'driver', status: 'active', grantedAt: at(40_000) },
            { role: 'valet', status: 'pending', grantedAt: at(39_000) },
          ],
        },
        {
          id: id(4),
          name: null,
          phone: '+91 97654***21',
          status: 'blocked',
          createdAt: at(100_000),
          roles: [{ role: 'driver', status: 'active', grantedAt: at(100_000) }],
        },
      ]),
  ],
  [
    /^\/admin\/partners\/[^/?]+/,
    () => ({
      data: {
        userId: id(3),
        kind: 'washer',
        name: 'Arun M.',
        displayName: 'SparkleWash Koramangala',
        phone: '+91 90123***77',
        verificationStatus: 'pending',
        requestedAt: at(3000),
        vehicleNumber: null,
        operatingHours: null,
        documents: [
          {
            kind: 'id_proof',
            url: 'https://picsum.photos/seed/doc1/600/400',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          },
          {
            kind: 'business_photo',
            url: 'https://picsum.photos/seed/biz1/600/400',
            expiresAt: null,
          },
        ],
      },
    }),
  ],
  [
    /^\/admin\/partners/,
    () =>
      page([
        {
          userId: id(3),
          kind: 'washer',
          name: 'Arun M.',
          displayName: 'SparkleWash Koramangala',
          phone: '+91 90123***77',
          verificationStatus: 'pending',
          requestedAt: at(3000),
        },
      ]),
  ],
  [
    /^\/admin\/bookings\/[^/?]+/,
    () => ({
      data: {
        id: id(500),
        status: 'completed',
        driver: { id: id(1), name: 'Ravi Kumar', phone: '+91 98765***10' },
        space: { id: id(100), title: SPACE.title, ownerName: SPACE.ownerName },
        startsAt: at(300),
        endsAt: at(180),
        totalPaise: 9702,
        ownerEarningsPaise: 5100,
        parkeaseFeePaise: 3900,
        gstPaise: 702,
        ledger: LEDGER,
        payments: [
          { id: id(600), status: 'captured', amountPaise: 9702, razorpayPaymentId: 'pay_XXXX' },
        ],
        refunds: [],
        refundablePaise: 9702,
        refundOptions: [
          { option: 'full_minus_fee', amountPaise: 8702 },
          { option: 'half', amountPaise: 4851 },
        ],
      },
    }),
  ],
  [
    /^\/admin\/bookings/,
    () =>
      page([
        {
          id: id(500),
          status: 'completed',
          driverName: 'Ravi Kumar',
          spaceTitle: SPACE.title,
          startsAt: at(300),
          endsAt: at(180),
          totalPaise: 9702,
        },
      ]),
  ],
  [
    /^\/admin\/finance\/balances/,
    () => ({
      data: {
        ...range,
        accounts: ACCOUNTS.map(([account, d, c, side]) => ({
          account,
          debitsPaise: d,
          creditsPaise: c,
          balancePaise: Math.abs(d - c),
          side,
        })),
        totalDebitsPaise: 107989000,
        totalCreditsPaise: 107989000,
        balanced: true,
      },
    }),
  ],
  [/^\/admin\/ledger/, () => cursor(LEDGER)],
  [
    /^\/admin\/payouts/,
    () =>
      page([
        {
          id: id(700),
          userId: id(2),
          period: '2026-W40',
          grossPaise: 4100000,
          netPaise: 4100000,
          status: 'paid',
          razorpayPayoutId: 'pout_XXXX',
          failureReason: null,
          createdAt: at(2000),
        },
      ]),
  ],
  [/^\/admin\/reconciliation/, () => ({ data: [] })],
  [
    /^\/admin\/moderation\/reviews/,
    () =>
      cursor([
        {
          id: id(300),
          targetType: 'space',
          targetId: id(100),
          rating: 1,
          comment: 'this is spam buy followers link <script>alert(1)</script>',
          createdAt: at(1500),
          reports: [{ reason: 'spam_or_fake', detail: null, createdAt: at(60) }],
          impact: { currentAvgBp: 42000, avgBpIfRemoved: 46000, countIfRemoved: 17 },
        },
      ]),
  ],
  [
    /^\/admin\/audit/,
    () =>
      cursor([
        {
          id: id(400),
          occurredAt: at(10),
          actorUserId: id(9),
          actorName: 'Onkar D.',
          actorRole: 'admin',
          action: 'user.role.grant',
          targetType: 'user',
          targetId: id(2),
          before: null,
          after: { role: 'owner', reason: 'verified in person' },
          ipAddress: '10.0.0.4',
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        },
        {
          id: id(401),
          occurredAt: at(30),
          actorUserId: id(9),
          actorName: 'Onkar D.',
          actorRole: 'admin',
          action: 'space.request-changes',
          targetType: 'space',
          targetId: id(101),
          before: { approvalStatus: 'pending_approval' },
          after: { approvalStatus: 'changes_requested' },
          ipAddress: '10.0.0.4',
          traceId: null,
        },
      ]),
  ],
  [
    /^\/admin\/surge\/config/,
    () => ({
      data: {
        maxMultiplierBp: 20000,
        peakHourModifierBp: 11000,
        weekendModifierBp: 10500,
        eventModifierBp: 12000,
        occupancyWindowMinutes: 60,
        peakWindows: [],
        tiers: DEFAULT_SURGE_TIERS,
        updatedAt: at(500),
      },
    }),
  ],
  [
    /^\/admin\/surge\/heatmap/,
    () => ({
      data: ['tdr1up', 'tdr1vx', 'tdr1wj', 'tdr1xk', 'tdr1v8', 'tdr1ug'].map((zoneId, n) => ({
        zoneId,
        activeSpaces: 3 + n,
        overridden: zoneId === 'tdr1xk',
        live: {
          multiplierBp: [10000, 12500, 15000, 25000, 10000, 20000][n] ?? 10000,
          badge:
            [null, 'moderate_demand', 'high_demand', 'very_high_demand', null, 'very_high_demand'][
              n
            ] ?? null,
          occupancyBp: 4000 + n * 1000,
          appliedModifiers: [],
          calculatedAt: at(3),
        },
      })),
    }),
  ],
  [
    /^\/admin\/surge\/zones/,
    () => ({
      data: [
        {
          zoneId: 'tdr1xk',
          label: 'Airport Road',
          enabled: true,
          maxMultiplierBp: 25000,
          tiers: null,
          live: {
            multiplierBp: 15000,
            badge: 'high_demand',
            occupancyBp: 7800,
            appliedModifiers: ['peak_hour'],
            calculatedAt: at(3),
          },
        },
      ],
    }),
  ],
];

export function fixtureFor(method: string, path: string): Fixture {
  if (method !== 'GET') return { data: {} };
  const match = GET.find(([pattern]) => pattern.test(path));
  if (match === undefined) throw new Error(`No admin fixture for GET ${path}`);
  return match[1]();
}
