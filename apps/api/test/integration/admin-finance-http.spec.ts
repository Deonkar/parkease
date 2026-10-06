import v8 from 'node:v8';
import vm from 'node:vm';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type BookingStack, buildBookingStack, windowFromNow, zoneOf } from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
  truncateSpaces,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const ACCOUNTS = [
  'driver_receivable',
  'owner_payable',
  'platform_revenue',
  'gst_payable',
  'tcs_payable',
  'tds_payable',
  'gateway_fees',
  'refunds_payable',
  'promo_expense',
  'settlement_clearing',
];

interface Envelope {
  readonly data?: unknown;
  readonly meta?: { limit: number; hasMore: boolean; nextCursor: string | null } & Record<
    string,
    unknown
  >;
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

interface BalanceRow {
  account: string;
  debitsPaise: number;
  creditsPaise: number;
  balancePaise: number;
  side: 'dr' | 'cr' | null;
}

interface Balances {
  from: string;
  to: string;
  accounts: BalanceRow[];
  totalDebitsPaise: number;
  totalCreditsPaise: number;
  balanced: boolean;
}

interface KpiQuery {
  account: string;
  side: 'debit' | 'credit' | 'net_credit';
  from: string;
  to: string;
}

interface Dashboard {
  grossPaise: number;
  platformRevenuePaise: number;
  ownerPayablePaise: number;
  gstPayablePaise: number;
  queries: Record<'gross' | 'platformRevenue' | 'ownerPayable' | 'gstPayable', KpiQuery>;
  bookings: number;
  activeSpaces: number;
  pending: { spaces: number; partners: number; reports: number };
  ledger: { balanced: boolean; imbalancedTxnIds: string[] };
}

interface Entry {
  id: string;
  txnId: string;
  account: string;
  direction: string;
  amountPaise: number;
  description: string;
  occurredAt: string;
}

/** `--expose-gc` without restarting the runner: the flag can be set on a live isolate. */
v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const dataOf = <T>(r: { body: unknown }): T => envelope(r).data as T;

/** An IST calendar date `offsetDays` from today. A wide window keeps midnight from splitting a test. */
const istDate = (offsetDays: number): string =>
  new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Admin finance (task 18a) through the real Fastify pipeline against a real ledger. The point of
 * the file is one property: the dashboard, the balances screen, the explorer and the export are
 * four views of the same rows, and they agree because they are derived from one aggregate. Every
 * agreement assertion reads the ledger back with plain SQL, not with the code under test.
 */
describe('admin finance HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;
  let adminId: string;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };
  const read = (url: string) => http.request({ method: 'GET', url });

  /** Wide enough that the clock crossing IST midnight mid-test cannot move a row out of range. */
  const FROM = istDate(-1);
  const TO = istDate(2);
  const RANGE = `from=${FROM}&to=${TO}`;

  const insertPosting = (occurredAt: string, amountPaise: number, description: string) =>
    h.sql`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, occurred_at)
      SELECT t, a, d, ${amountPaise}, ${description}, ${occurredAt}::timestamptz
      FROM (SELECT gen_random_uuid() AS t) x,
           (VALUES ('driver_receivable', 'debit'), ('platform_revenue', 'credit')) v(a, d)`;

  const paidBooking = async (title: string, hoursAhead: number) => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1, title });
    const driverId = await seedUser(h, 'driver');
    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const window = windowFromNow(hoursAhead, 2);
    const { booking } = await stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: 'KA-01-AB-1234',
    });
    h.redis.clear();
    await h.sql`UPDATE bookings SET status = 'completed' WHERE id = ${booking.id}`;
    // slice(-12): a UUIDv7's leading bits are its timestamp, so ids minted in one millisecond share a prefix.
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${booking.id}, ${driverId}, ${`order_${booking.id.slice(-12)}`},
              ${`pay_${booking.id.slice(-12)}`}, ${booking.totalPaise}, ${booking.totalPaise},
              'captured', now())`;
    return booking.id;
  };

  const sumWhere = async (account: string, direction: string, from: string, to: string) => {
    const [row] = await h.sql<{ s: string }[]>`
      SELECT coalesce(sum(amount_paise), 0)::text AS s FROM ledger_entries
      WHERE account = ${account} AND direction = ${direction}
        AND occurred_at >= ${`${from}T00:00:00+05:30`}::timestamptz
        AND occurred_at < ${`${to}T00:00:00+05:30`}::timestamptz`;
    return Number(row?.s);
  };

  const ledgerCountIn = async (from: string, to: string) => {
    const [row] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE occurred_at >= ${`${from}T00:00:00+05:30`}::timestamptz
        AND occurred_at < ${`${to}T00:00:00+05:30`}::timestamptz`;
    return row?.n ?? -1;
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    stack = buildBookingStack(h);
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  describe('over a seeded ledger', () => {
    beforeAll(async () => {
      await truncateSpaces(h);
      await h.sql`TRUNCATE audit_log, idempotency_keys, outbox_messages, payouts CASCADE`;
      await h.sql`TRUNCATE reconciliation_mismatches`;
      asAdmin();

      // Three bookings, one admin refund.
      const refunded = await paidBooking('Koramangala Basement', 2);
      await paidBooking('Indiranagar Lot', 6);
      await paidBooking('HSR Layout Garage', 10);
      const refund = await http.request({
        method: 'POST',
        url: `/api/v1/admin/bookings/${refunded}/refund`,
        payload: { option: 'full_minus_fee', reason: 'spot flooded' },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(refund.status).toBe(200);

      // A payout posting: money leaving owner_payable for the rail.
      const ownerId = await seedUser(h, 'owner');
      const txnId = crypto.randomUUID();
      const [payout] = await h.sql<{ id: string }[]>`
        INSERT INTO payouts (user_id, period, gross_paise, net_paise, txn_id,
                             razorpayx_fund_account_id, status, razorpay_payout_id)
        VALUES (${ownerId}, '2026-W40', 5000, 5000, ${txnId}, 'fa_test', 'paid', 'pout_test')
        RETURNING id`;
      await h.sql`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, payout_id)
        VALUES (${txnId}, 'owner_payable', 'debit', 5000, 'weekly payout', ${payout?.id ?? null}),
               (${txnId}, 'settlement_clearing', 'credit', 5000, 'weekly payout', ${payout?.id ?? null})`;
      await h.sql`
        INSERT INTO payouts (user_id, period, gross_paise, net_paise, txn_id,
                             razorpayx_fund_account_id, status, failure_reason)
        VALUES (${ownerId}, '2026-W39', 2000, 2000, ${crypto.randomUUID()}, 'fa_test', 'failed',
                'beneficiary account closed')`;
      await h.sql`
        INSERT INTO reconciliation_mismatches (kind, reference, expected_paise, actual_paise, detail)
        VALUES ('amount_mismatch', 'pay_mismatch_1', 9702, 9000, 'gateway captured less than expected'),
               ('payout_failed', 'pout_failed_1', NULL, NULL, 'payout bounced')`;

      // Two earlier months, a posting 30 minutes after IST midnight on the 1st (still the previous
      // month in UTC), and a description a spreadsheet would run. Fixed past dates, so a re-run
      // on any day sees the same ledger.
      await insertPosting('2025-08-12T10:00:00Z', 10_000, 'august');
      await insertPosting('2025-09-12T10:00:00Z', 20_000, 'september');
      await insertPosting('2025-09-30T19:00:00Z', 700, 'first of october, IST');
      await insertPosting(new Date().toISOString(), 300, '=HYPERLINK("http://evil.example","x")');
    }, 120_000);

    it('dashboard and finance agree on platform revenue, gross, GST and owner payable', async () => {
      const dashboard = dataOf<Dashboard>(await read(`/api/v1/admin/dashboard?${RANGE}`));
      const balances = dataOf<Balances>(await read(`/api/v1/admin/finance/balances?${RANGE}`));
      const row = (account: string) => {
        const found = balances.accounts.find((a) => a.account === account);
        if (found === undefined) throw new Error(`no balances row for ${account}`);
        return found;
      };

      expect(dashboard.platformRevenuePaise).toBe(row('platform_revenue').creditsPaise);
      expect(dashboard.grossPaise).toBe(row('driver_receivable').debitsPaise);
      expect(dashboard.gstPayablePaise).toBe(row('gst_payable').creditsPaise);
      expect(dashboard.ownerPayablePaise).toBe(row('owner_payable').creditsPaise);
      // Not vacuous: three bookings of ₹97.02 are in this range.
      expect(dashboard.grossPaise).toBeGreaterThanOrEqual(3 * 9702);
      expect(dashboard.platformRevenuePaise).toBeGreaterThan(0);
    });

    it('each card reproduces from its own queries entry, run as plain SQL', async () => {
      const dashboard = dataOf<Dashboard>(await read(`/api/v1/admin/dashboard?${RANGE}`));
      const cards = {
        gross: dashboard.grossPaise,
        platformRevenue: dashboard.platformRevenuePaise,
        ownerPayable: dashboard.ownerPayablePaise,
        gstPayable: dashboard.gstPayablePaise,
      } as const;

      for (const [name, value] of Object.entries(cards)) {
        const query = dashboard.queries[name as keyof typeof cards];
        expect(['debit', 'credit']).toContain(query.side);
        expect(await sumWhere(query.account, query.side, query.from, query.to)).toBe(value);
      }
    });

    it('platform revenue is the bookings fees less the fee refunded; the ledger is authoritative', async () => {
      const balances = dataOf<Balances>(await read(`/api/v1/admin/finance/balances?${RANGE}`));
      const revenue = balances.accounts.find((a) => a.account === 'platform_revenue');

      const [fees] = await h.sql<{ s: string }[]>`
        SELECT coalesce(sum(b.parkease_fee_paise), 0)::text AS s FROM bookings b
        WHERE EXISTS (SELECT 1 FROM ledger_entries l WHERE l.booking_id = b.id
                        AND l.occurred_at >= ${`${FROM}T00:00:00+05:30`}::timestamptz
                        AND l.occurred_at < ${`${TO}T00:00:00+05:30`}::timestamptz)`;
      const [refundedFee] = await h.sql<{ s: string }[]>`
        SELECT coalesce(sum(amount_paise), 0)::text AS s FROM ledger_entries
        WHERE account = 'platform_revenue' AND direction = 'debit' AND booking_id IS NOT NULL
          AND occurred_at >= ${`${FROM}T00:00:00+05:30`}::timestamptz
          AND occurred_at < ${`${TO}T00:00:00+05:30`}::timestamptz`;

      // The 300 paise hand-seeded posting for the injection test has no booking: it is in the ledger
      // and not in the bookings, which is exactly why the ledger is the number a finance screen shows.
      const hand = 300;
      expect(refundedFee?.s).not.toBe('0');
      expect(
        (revenue?.creditsPaise ?? 0) - (revenue?.debitsPaise ?? 0),
        'the ledger is authoritative: bookings.parkease_fee_paise less fee refunded diverged from platform_revenue',
      ).toBe(Number(fees?.s) - Number(refundedFee?.s) + hand);
    });

    it('balances carry all ten accounts, a zero tcs_payable, and balance', async () => {
      const response = await read(`/api/v1/admin/finance/balances?${RANGE}`);
      expect(response.status).toBe(200);
      const balances = dataOf<Balances>(response);

      expect(balances.accounts.map((a) => a.account)).toEqual(ACCOUNTS);
      expect(balances.accounts.find((a) => a.account === 'tcs_payable')).toEqual({
        account: 'tcs_payable',
        debitsPaise: 0,
        creditsPaise: 0,
        balancePaise: 0,
        side: null,
      });
      expect(balances.balanced).toBe(true);
      expect(balances.totalDebitsPaise).toBe(balances.totalCreditsPaise);
      expect(balances.accounts.find((a) => a.account === 'driver_receivable')?.side).toBe('dr');
      expect(balances.accounts.find((a) => a.account === 'owner_payable')?.side).toBe('cr');
    });

    it('buckets by IST day: a posting at 00:30 IST on the 1st belongs to that month, not the last', async () => {
      const revenue = async (from: string, to: string) =>
        dataOf<Balances>(
          await read(`/api/v1/admin/finance/balances?from=${from}&to=${to}`),
        ).accounts.find((a) => a.account === 'platform_revenue')?.creditsPaise;

      expect(await revenue('2025-08-01', '2025-09-01')).toBe(10_000);
      // September holds its own 20 000 but NOT the 700 that is 00:30 IST on 1 October.
      expect(await revenue('2025-09-01', '2025-10-01')).toBe(20_000);
      expect(await revenue('2025-10-01', '2025-10-02')).toBe(700);
      // Two months at once.
      expect(await revenue('2025-08-01', '2025-10-01')).toBe(30_000);
    });

    it('reports an imbalanced posting by txn id and flips the ledger flag, in its own range', async () => {
      const txnId = crypto.randomUUID();
      await h.sql`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, occurred_at)
        VALUES (${txnId}, 'driver_receivable', 'debit', 100, 'broken', '2025-07-10T10:00:00Z')`;

      const broken = dataOf<Dashboard>(
        await read('/api/v1/admin/dashboard?from=2025-07-01&to=2025-08-01'),
      );
      expect(broken.ledger).toEqual({ balanced: false, imbalancedTxnIds: [txnId] });
      const brokenBalances = dataOf<Balances>(
        await read('/api/v1/admin/finance/balances?from=2025-07-01&to=2025-08-01'),
      );
      expect(brokenBalances.balanced).toBe(false);

      // And the healthy range is untouched by it.
      const healthy = dataOf<Dashboard>(await read(`/api/v1/admin/dashboard?${RANGE}`));
      expect(healthy.ledger).toEqual({ balanced: true, imbalancedTxnIds: [] });
    });

    it('counts what is waiting on an admin and the bookings in range', async () => {
      const dashboard = dataOf<Dashboard>(await read(`/api/v1/admin/dashboard?${RANGE}`));
      expect(dashboard.bookings).toBe(3);
      expect(dashboard.activeSpaces).toBe(3);
      expect(dashboard.pending).toEqual({ spaces: 0, partners: 0, reports: 0 });
    });

    describe('explorer', () => {
      it('filters by account', async () => {
        const response = await read(
          `/api/v1/admin/ledger?account=platform_revenue&limit=200&${RANGE}`,
        );
        expect(response.status).toBe(200);
        const entries = dataOf<Entry[]>(response);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries.every((e) => e.account === 'platform_revenue')).toBe(true);
        expect(envelope(response).meta).toMatchObject({ hasMore: false, nextCursor: null });
      });

      it('pages newest first with no duplicates and no gaps over three pages', async () => {
        const expected = await h.sql<{ id: string }[]>`
          SELECT id FROM ledger_entries
          WHERE occurred_at >= ${`${FROM}T00:00:00+05:30`}::timestamptz
            AND occurred_at < ${`${TO}T00:00:00+05:30`}::timestamptz
          ORDER BY occurred_at DESC, id DESC`;
        const limit = Math.ceil(expected.length / 3);
        expect(limit).toBeGreaterThan(1);

        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const response: Awaited<ReturnType<typeof read>> = await read(
            `/api/v1/admin/ledger?limit=${String(limit)}&${RANGE}${cursor === null ? '' : `&cursor=${cursor}`}`,
          );
          expect(response.status).toBe(200);
          const page = dataOf<Entry[]>(response);
          seen.push(...page.map((e) => e.id));
          cursor = envelope(response).meta?.nextCursor ?? null;
          pages += 1;
          expect(pages).toBeLessThanOrEqual(4);
        } while (cursor !== null);

        expect(pages).toBe(3);
        expect(new Set(seen).size).toBe(seen.length);
        // Same rows in the same order: a posting's rows share occurred_at, so only `id` orders them.
        expect(seen).toEqual(expected.map((r) => r.id));
      });

      it('answers 400 for a cursor it did not issue and for an inverted range', async () => {
        const garbage = await read('/api/v1/admin/ledger?cursor=bm90LWEtY3Vyc29y');
        expect(garbage.status).toBe(400);
        expect(envelope(garbage).error?.code).toBe('VALIDATION_FAILED');

        // Valid shape, impossible instant: Postgres would refuse the cast, so it must stop at Zod.
        const id = '0192f1c0-0000-7000-8000-000000000001';
        for (const text of [
          `9999-99-99T99:99:99.000000Z|${id}`,
          `2026-02-30T00:00:00.000000Z|${id}`,
          'not base64url json at all',
        ]) {
          const cursor = Buffer.from(text, 'utf8').toString('base64url');
          const tampered = await read(`/api/v1/admin/ledger?cursor=${cursor}`);
          expect(tampered.status, text).toBe(400);
          expect(envelope(tampered).error?.code, text).toBe('VALIDATION_FAILED');
        }
        const notBase64 = await read('/api/v1/admin/ledger?cursor=%7B%22a%22%3A1%7D');
        expect(notBase64.status).toBe(400);
        expect(envelope(notBase64).error?.code).toBe('VALIDATION_FAILED');

        const inverted = await read('/api/v1/admin/ledger?from=2026-10-08&to=2026-10-01');
        expect(inverted.status).toBe(400);
        expect(envelope(inverted).error?.code).toBe('VALIDATION_FAILED');
      });
    });

    describe('export', () => {
      it('streams CSV: no content-length, a named file, paise only, one line per entry', async () => {
        const response = await read(`/api/v1/admin/ledger/export?${RANGE}`);
        expect(response.status).toBe(200);

        expect(response.headers['content-length']).toBeUndefined();
        expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="ledger-${FROM}-${TO}.csv"`,
        );
        expect(response.headers['cache-control']).toBe('no-store');

        const text = response.body as string;
        expect(typeof text).toBe('string');
        expect(text).not.toContain('₹');

        const lines = text.split('\r\n');
        expect(lines.pop()).toBe(''); // every row, the last included, ends its line
        expect(lines[0]).toBe(
          'id,txn_id,occurred_at,account,direction,amount_paise,booking_id,payout_id,description',
        );
        expect(lines.length - 1).toBe(await ledgerCountIn(FROM, TO));

        const amountColumn = lines.slice(1).map((line) => line.split(',')[5]);
        expect(amountColumn.every((cell) => cell !== undefined && /^\d+$/.test(cell))).toBe(true);
      });

      it('neutralises a description a spreadsheet would execute', async () => {
        const text = (await read(`/api/v1/admin/ledger/export?${RANGE}`)).body as string;
        const line = text.split('\r\n').find((l) => l.includes('HYPERLINK'));
        // Prefixed with an apostrophe, then quoted because it holds commas and quotes.
        expect(line?.endsWith(`,"'=HYPERLINK(""http://evil.example"",""x"")"`)).toBe(true);
      });

      it('answers 400 as JSON for a bad range, before any CSV byte', async () => {
        const response = await read('/api/v1/admin/ledger/export?from=2026-01-01&to=2027-06-01');
        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toContain('application/json');
        expect(envelope(response).error?.code).toBe('VALIDATION_FAILED');
      });
    });

    it('lists the seeded payouts, filtered by status, and the reconciliation findings', async () => {
      const all = await read('/api/v1/admin/payouts');
      expect(all.status).toBe(200);
      expect(envelope(all).meta).toMatchObject({ page: 1, total: 2 });
      expect(
        dataOf<{ period: string }[]>(all)
          .map((p) => p.period)
          .sort(),
      ).toEqual(['2026-W39', '2026-W40']);

      const failed = dataOf<{ status: string; failureReason: string | null; netPaise: number }[]>(
        await read('/api/v1/admin/payouts?status=failed'),
      );
      expect(failed).toEqual([
        expect.objectContaining({
          status: 'failed',
          failureReason: 'beneficiary account closed',
          netPaise: 2000,
        }),
      ]);

      const findings = dataOf<{ kind: string; reference: string; expectedPaise: number | null }[]>(
        await read(`/api/v1/admin/reconciliation?${RANGE}`),
      );
      expect(findings.map((f) => f.reference).sort()).toEqual(['pay_mismatch_1', 'pout_failed_1']);
      expect(findings.find((f) => f.reference === 'pay_mismatch_1')).toMatchObject({
        kind: 'amount_mismatch',
        expectedPaise: 9702,
        actualPaise: 9000,
        resolvedAt: null,
      });
    });

    it('refuses a non-admin on every route, as the JSON error envelope and never as CSV', async () => {
      actingAs.user = { id: crypto.randomUUID(), roles: ['driver'], activeRole: 'driver' };
      try {
        for (const url of [
          `/api/v1/admin/dashboard?${RANGE}`,
          `/api/v1/admin/finance/balances?${RANGE}`,
          '/api/v1/admin/ledger',
          `/api/v1/admin/ledger/export?${RANGE}`,
          '/api/v1/admin/payouts',
          `/api/v1/admin/reconciliation?${RANGE}`,
        ]) {
          const response = await read(url);
          expect(response.status, url).toBe(403);
          expect(response.headers['content-type'], url).toContain('application/json');
          expect(envelope(response).error?.code, url).toBeDefined();
          expect(JSON.stringify(response.body), url).not.toContain('amount_paise');
        }
      } finally {
        asAdmin();
      }
    });
  });

  describe('streaming a large ledger', () => {
    const PAIRS = 125_000; // 250 000 rows
    const BULK_FROM = '2025-05-01';
    const BULK_TO = '2025-05-02';

    beforeAll(async () => {
      await truncateSpaces(h);
      asAdmin();
      await h.sql`
        WITH pairs AS (
          SELECT g, gen_random_uuid() AS t,
                 '2025-05-01T00:00:00+05:30'::timestamptz + g * interval '0.5 second' AS ts
          FROM generate_series(1, ${PAIRS}::int) g
        )
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, occurred_at)
        SELECT t, v.account, v.direction, 1000 + g % 500, 'bulk ledger posting number ' || g, ts
        FROM pairs
        CROSS JOIN LATERAL (VALUES ('driver_receivable', 'debit'), ('platform_revenue', 'credit'))
          AS v(account, direction)`;
    }, 180_000);

    it('sends the first row well before the last, and holds one batch in memory, not the file', async () => {
      const [{ n } = { n: 0 }] = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ledger_entries`;
      expect(n).toBe(PAIRS * 2);

      // Collect before each sample. Without it V8 simply has not got round to freeing the
      // short-lived batches (RSS rose ~118 MB on a 42 MB response with no GC, ~17 MB with it), and the
      // number would measure the collector's laziness, not whether the response is held in memory.
      collectGarbage();
      const baselineRss = process.memoryUsage().rss;
      let peakRss = baselineRss;
      const sampler = setInterval(() => {
        collectGarbage();
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }, 50);

      const startedAt = performance.now();
      let firstRowAt = 0;
      let lines = 0;
      let bytes = 0;
      let chunks = 0;
      let tail = '';
      let headersSeen: Record<string, unknown> = {};

      try {
        const response = await http.app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: 'GET',
            url: `/api/v1/admin/ledger/export?from=${BULK_FROM}&to=${BULK_TO}`,
            payloadAsStream: true,
          });
        headersSeen = response.headers;
        expect(response.statusCode).toBe(200);

        for await (const chunk of response.stream()) {
          const text = (chunk as Buffer).toString('utf8');
          chunks += 1;
          bytes += Buffer.byteLength(text);
          // The header line alone does not count: the first chunk that carries a ledger row does.
          if (firstRowAt === 0 && text.includes('bulk ledger posting')) {
            firstRowAt = performance.now() - startedAt;
          }
          for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines += 1;
          tail = text.slice(-2);
        }
      } finally {
        clearInterval(sampler);
      }

      const totalMs = performance.now() - startedAt;
      const riseMb = (peakRss - baselineRss) / 1_048_576;
      // Reported, so a regression is visible as a trend before it is a failure.
      process.stdout.write(
        `[export stream] rows=${String(lines - 1)} bytes=${String(bytes)} chunks=${String(chunks)} ` +
          `firstRowMs=${firstRowAt.toFixed(0)} totalMs=${totalMs.toFixed(0)} ` +
          `firstRowShare=${((firstRowAt / totalMs) * 100).toFixed(1)}% rssRiseMb=${riseMb.toFixed(1)}\n`,
      );

      expect(headersSeen['content-length']).toBeUndefined();
      expect(tail).toBe('\r\n');
      expect(lines - 1).toBe(PAIRS * 2);
      expect(chunks).toBeGreaterThan(50); // 250 batches of 1000, not one blob
      expect(firstRowAt).toBeGreaterThan(0);
      expect(firstRowAt / totalMs).toBeLessThan(0.25);
      expect(riseMb).toBeLessThan(150);
    }, 180_000);
  });
});
