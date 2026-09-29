import {
  computeValetLegFee,
  routeDischargeEntries,
  settlementClearedEntries,
  valetLegEntries,
} from '@parkease/contracts/money';
import { toRate } from '@parkease/contracts/primitives';
import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { postLedger } from '../../src/jobs/booking/ledger.js';
import type { TransferGateway } from '../../src/jobs/payment/razorpay.js';
import { failPayout } from '../../src/jobs/payout/fail.js';
import { type PayoutGateway, RazorpayXError } from '../../src/jobs/payout/razorpayx.js';
import { reconcilePayouts } from '../../src/jobs/payout/reconcile.job.js';
import { runWeeklyPayouts } from '../../src/jobs/payout/run-weekly.job.js';
import { sendPayout } from '../../src/jobs/payout/send.job.js';
import { logger } from '../../src/logger.js';

let pg: PgTestContext;
let deps: JobDeps;

const MONDAY = new Date('2026-09-28T00:30:00Z'); // Mon 06:00 IST, 2026-W40
const ON = { accountNumber: '2323230000000001', now: MONDAY };

let seq = 0;
async function seedUser(role: string): Promise<string> {
  seq += 1;
  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9196${String(10_000_000 + seq)}`}, ${`fb-${role}-${String(seq)}-${String(Math.random())}`}, ${`${role} ${String(seq)}`})
    RETURNING id`;
  if (row === undefined) throw new Error('seed user');
  await pg.sql`INSERT INTO user_roles (user_id, role) VALUES (${row.id}, ${role})`;
  return row.id;
}

async function withBank(
  userId: string,
  fundAccountId: string | null = 'fa_QK7l1nValet',
): Promise<void> {
  await pg.sql`
    INSERT INTO bank_details (user_id, account_number_encrypted, ifsc_encrypted,
                              account_holder_name, last4, ifsc_prefix,
                              razorpayx_contact_id, razorpayx_fund_account_id)
    VALUES (${userId}, 'x.y.z', 'x.y.z', 'Valet', '6789', 'HDFC', 'cont_QK7l1n', ${fundAccountId})`;
}

/** A valet leg credit of `fee`'s valet share — exactly what accept-job posts. */
async function earn(valetId: string, distanceM = 10_000): Promise<number> {
  const fee = computeValetLegFee(distanceM, toRate(0.2));
  await deps.db.transaction(async (tx) => {
    await postLedger(tx, { entries: valetLegEntries(fee, valetId, 'valet leg') });
  });
  return fee.valetEarningsPaise;
}

const owedTo = async (userId: string) => {
  const [row] = await pg.sql<{ net: string }[]>`
    SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net
    FROM ledger_entries WHERE account = 'owner_payable' AND counterparty_user_id = ${userId}`;
  return Number(row?.net);
};

const payoutsOf = (userId: string) =>
  pg.sql<
    { id: string; status: string; gross: string; net: string; txn_id: string; rzp: string | null }[]
  >`
    SELECT id, status, gross_paise::text AS gross, net_paise::text AS net, txn_id,
           razorpay_payout_id AS rzp
    FROM payouts WHERE user_id = ${userId}`;

function gateway(overrides: Partial<PayoutGateway> = {}): PayoutGateway {
  return {
    create: vi.fn().mockResolvedValue({ id: 'pout_QK7l1nFirst', status: 'processing' }),
    fetch: vi.fn(),
    ...overrides,
  } as PayoutGateway;
}

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    redis: {} as JobDeps['redis'],
  };
}, 300_000);

afterAll(async () => {
  await stopPgContainer(pg);
});

beforeEach(async () => {
  await pg.sql`TRUNCATE outbox_messages, ledger_entries, payouts, bank_details, linked_accounts,
                        bookings, spaces, user_roles, users CASCADE`;
  vi.clearAllMocks();
});

describe('payout.run-weekly', () => {
  it('pays a valet their whole balance once, balanced, and queues the send', async () => {
    const valet = await seedUser('valet');
    await withBank(valet);
    const earned = (await earn(valet)) + (await earn(valet, 2000));

    await runWeeklyPayouts(deps, ON);
    await runWeeklyPayouts(deps, ON); // the redelivery, or a second run the same Monday

    const rows = await payoutsOf(valet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      gross: String(earned),
      net: String(earned),
    });
    expect(await owedTo(valet)).toBe(0);

    const posting = await pg.sql<
      { account: string; direction: string; payout_id: string | null }[]
    >`
      SELECT account, direction, payout_id FROM ledger_entries WHERE txn_id = ${rows[0]?.txn_id ?? ''}
      ORDER BY account`;
    expect(posting).toEqual([
      { account: 'owner_payable', direction: 'debit', payout_id: rows[0]?.id },
      { account: 'settlement_clearing', direction: 'credit', payout_id: rows[0]?.id },
    ]);

    const sends = await pg.sql<{ payload: { payoutId: string } }[]>`
      SELECT payload FROM outbox_messages WHERE type = 'payout.send'`;
    expect(sends.map((s) => s.payload.payoutId)).toEqual([rows[0]?.id]);
  });

  it('skips a balance under ₹100', async () => {
    const valet = await seedUser('valet');
    await withBank(valet);
    const small = computeValetLegFee(0, toRate(0.9)); // ₹50 base, 10% to the valet: ₹5
    await deps.db.transaction(async (tx) => {
      await postLedger(tx, { entries: valetLegEntries(small, valet, 'valet leg') });
    });

    await runWeeklyPayouts(deps, ON);

    expect(await payoutsOf(valet)).toHaveLength(0);
  });

  it('never pays a Route-onboarded partner — Route already did (one rail per payee)', async () => {
    const washer = await seedUser('washer');
    await withBank(washer);
    await pg.sql`INSERT INTO linked_accounts (user_id, razorpay_account_id, kyc_status)
                 VALUES (${washer}, 'acc_QK7l1nWasher', 'activated')`;
    await earn(washer);
    // Beside a valet with no Linked Account, so a subquery that correlated
    // nothing (true for everyone once any account is activated) fails here.
    const valet = await seedUser('valet');
    await withBank(valet);
    await earn(valet);

    await runWeeklyPayouts(deps, ON);

    expect(await payoutsOf(washer)).toHaveLength(0);
    expect(await payoutsOf(valet)).toHaveLength(1);
  });

  it('never treats the driver stamped on an owner-side row as a payee', async () => {
    const driver = await seedUser('driver');
    await withBank(driver);
    const owner = await seedUser('owner');
    const [space] = await pg.sql<{ id: string }[]>`
      INSERT INTO spaces (owner_id, title, address_line, city, state, pincode, location, zone_id,
                          pricing, schedule, amenities, approval_status)
      VALUES (${owner}, 'Basement', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
              ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geography, 'tdr1w6',
              ${JSON.stringify({ car: { hourlyPaise: 3000 } })}::jsonb,
              ${JSON.stringify({ is24x7: true })}::jsonb, '[]'::jsonb, 'active')
      RETURNING id`;
    const [booking] = await pg.sql<{ id: string }[]>`
      INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at,
                            base_paise, surge_premium_paise, parkease_fee_paise, gst_paise,
                            total_paise, owner_earnings_paise, status)
      VALUES (${driver}, ${space?.id ?? ''}, 'car', 'hourly', now(), now() + interval '8 hours',
              24000, 0, 3600, 648, 24648, 20400, 'confirmed')
      RETURNING id`;
    // The booking posting stamps the DRIVER on the owner's owner_payable credit.
    await deps.db.transaction(async (tx) => {
      await postLedger(tx, {
        bookingId: booking?.id ?? '',
        counterpartyUserId: driver,
        entries: [
          {
            account: 'driver_receivable',
            direction: 'debit',
            amountPaise: 20_400,
            description: 'booking',
          },
          {
            account: 'owner_payable',
            direction: 'credit',
            amountPaise: 20_400,
            description: 'booking',
          },
        ],
      });
    });

    await runWeeklyPayouts(deps, ON);

    expect(await payoutsOf(driver)).toHaveLength(0);
  });

  it('skips a payee with no fund account, and keeps the balance', async () => {
    const valet = await seedUser('valet');
    const earned = await earn(valet);

    await runWeeklyPayouts(deps, ON);

    expect(await payoutsOf(valet)).toHaveLength(0);
    expect(await owedTo(valet)).toBe(earned);
  });

  it('one payee failing does not strand the rest, and the run still reports it', async () => {
    const broken = await seedUser('valet');
    const fine = await seedUser('valet');
    await withBank(broken);
    await withBank(fine);
    await earn(broken);
    await earn(fine);
    await pg.sql.unsafe(`
      CREATE FUNCTION refuse_payout() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id = '${broken}' THEN RAISE EXCEPTION 'injected failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER refuse_payout BEFORE INSERT ON payouts
        FOR EACH ROW EXECUTE FUNCTION refuse_payout();`);

    try {
      await expect(runWeeklyPayouts(deps, ON)).rejects.toThrow(/1 payee/);
      expect(await payoutsOf(fine)).toHaveLength(1);
      expect(await payoutsOf(broken)).toHaveLength(0);
    } finally {
      await pg.sql.unsafe('DROP TRIGGER refuse_payout ON payouts; DROP FUNCTION refuse_payout();');
    }
  });

  it('a failed payout is not re-paid by a second run in the same week — next Monday pays it', async () => {
    const valet = await seedUser('valet');
    await withBank(valet);
    const net = await earn(valet);
    await runWeeklyPayouts(deps, ON);
    const [row] = await payoutsOf(valet);
    await failPayout(deps, row?.id ?? '', 'refused');

    await runWeeklyPayouts(deps, ON);

    expect(await payoutsOf(valet)).toHaveLength(1);
    expect(await owedTo(valet)).toBe(net);
  });

  it('pays nobody while RazorpayX is not configured', async () => {
    const valet = await seedUser('valet');
    await withBank(valet);
    await earn(valet);

    await runWeeklyPayouts(deps, { accountNumber: undefined, now: MONDAY });

    expect(await payoutsOf(valet)).toHaveLength(0);
  });
});

describe('payout.send', () => {
  async function pendingPayout(): Promise<{ valet: string; payoutId: string; net: number }> {
    const valet = await seedUser('valet');
    await withBank(valet);
    const net = await earn(valet);
    await runWeeklyPayouts(deps, ON);
    const [row] = await payoutsOf(valet);
    return { valet, payoutId: row?.id ?? '', net };
  }

  it('sends the net amount to the fund account, keyed by the payout id, once', async () => {
    const { valet, payoutId, net } = await pendingPayout();
    const rzp = gateway();

    await sendPayout(deps, { payoutId }, rzp, ON.accountNumber);
    await sendPayout(deps, { payoutId }, rzp, ON.accountNumber);

    expect(rzp.create).toHaveBeenCalledTimes(1);
    expect(rzp.create).toHaveBeenCalledWith({
      payoutId,
      accountNumber: ON.accountNumber,
      fundAccountId: 'fa_QK7l1nValet',
      amountPaise: net,
      period: '2026-W40',
    });
    expect((await payoutsOf(valet))[0]).toMatchObject({
      status: 'processing',
      rzp: 'pout_QK7l1nFirst',
    });
  });

  it('marks a refused payout failed, owes the money again, and tells the payee', async () => {
    const { valet, payoutId, net } = await pendingPayout();
    const rzp = gateway({ create: vi.fn().mockRejectedValue(new RazorpayXError(400, 'invalid')) });

    await sendPayout(deps, { payoutId }, rzp, ON.accountNumber);

    expect((await payoutsOf(valet))[0]?.status).toBe('failed');
    expect(await owedTo(valet)).toBe(net);
    const notes = await pg.sql<{ template: string }[]>`
      SELECT payload->>'template' AS template FROM outbox_messages WHERE type = 'notification.dispatch'`;
    expect(notes.map((n) => n.template)).toEqual(['payout.failed']);
  });

  it('throws on an outage so pg-boss retries, and the retry sends with the same key', async () => {
    const { valet, payoutId } = await pendingPayout();
    const down = gateway({ create: vi.fn().mockRejectedValue(new RazorpayXError(503, 'down')) });

    await expect(sendPayout(deps, { payoutId }, down, ON.accountNumber)).rejects.toThrow();
    expect((await payoutsOf(valet))[0]).toMatchObject({ status: 'processing', rzp: null });

    const up = gateway();
    await sendPayout(deps, { payoutId }, up, ON.accountNumber);
    expect(up.create).toHaveBeenCalledWith(expect.objectContaining({ payoutId }));
    expect((await payoutsOf(valet))[0]).toMatchObject({
      status: 'processing',
      rzp: 'pout_QK7l1nFirst',
    });
  });

  it('resends a resumed claim to the PINNED account even if bank details changed since', async () => {
    // The first attempt may have landed at RazorpayX; failing it now would
    // reverse money already moving. Same key, same account, same payout.
    const { valet, payoutId } = await pendingPayout();
    const down = gateway({ create: vi.fn().mockRejectedValue(new RazorpayXError(503, 'down')) });
    await expect(sendPayout(deps, { payoutId }, down, ON.accountNumber)).rejects.toThrow();
    await pg.sql`UPDATE bank_details SET razorpayx_fund_account_id = 'fa_QK7l1nNew'
                 WHERE user_id = ${valet}`;

    const up = gateway();
    await sendPayout(deps, { payoutId }, up, ON.accountNumber);

    expect(up.create).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId, fundAccountId: 'fa_QK7l1nValet' }),
    );
    expect((await payoutsOf(valet))[0]).toMatchObject({
      status: 'processing',
      rzp: 'pout_QK7l1nFirst',
    });
    const failed =
      await pg.sql`SELECT 1 FROM outbox_messages WHERE payload->>'template' = 'payout.failed'`;
    expect(failed).toHaveLength(0);
  });

  it('fails a payout exactly once, and never one already paid', async () => {
    const { valet, payoutId, net } = await pendingPayout();

    await failPayout(deps, payoutId, 'first');
    await failPayout(deps, payoutId, 'second');

    expect(await owedTo(valet)).toBe(net);
    const notes =
      await pg.sql`SELECT 1 FROM outbox_messages WHERE payload->>'template' = 'payout.failed'`;
    expect(notes).toHaveLength(1);

    const other = await pendingPayout();
    await pg.sql`UPDATE payouts SET status = 'paid' WHERE id = ${other.payoutId}`;
    await failPayout(deps, other.payoutId, 'too late');
    expect((await payoutsOf(other.valet))[0]?.status).toBe('paid');
    expect(await owedTo(other.valet)).toBe(0);
  });

  it('fails, rather than redirects, a payout whose bank details changed before it was sent', async () => {
    const { valet, payoutId, net } = await pendingPayout();
    // The change committed while this payout was being created, so cancelPending
    // could not see it: the payout is pinned to the OLD account.
    await pg.sql`UPDATE bank_details SET razorpayx_fund_account_id = 'fa_QK7l1nNew'
                 WHERE user_id = ${valet}`;
    const rzp = gateway();

    await sendPayout(deps, { payoutId }, rzp, ON.accountNumber);

    expect(rzp.create).not.toHaveBeenCalled();
    expect((await payoutsOf(valet))[0]?.status).toBe('failed');
    expect(await owedTo(valet)).toBe(net);
  });

  it.each([401, 409, 429])(
    'retries a %i instead of failing the payout — it is not the bank saying no',
    async (status) => {
      const { valet, payoutId } = await pendingPayout();
      const rzp = gateway({ create: vi.fn().mockRejectedValue(new RazorpayXError(status, 'x')) });

      await expect(sendPayout(deps, { payoutId }, rzp, ON.accountNumber)).rejects.toThrow();

      expect((await payoutsOf(valet))[0]?.status).toBe('processing');
    },
  );

  it('does not send a payout cancelled by a bank change', async () => {
    const { payoutId } = await pendingPayout();
    await pg.sql`UPDATE payouts SET status = 'cancelled' WHERE id = ${payoutId}`;
    const rzp = gateway();

    await sendPayout(deps, { payoutId }, rzp, ON.accountNumber);

    expect(rzp.create).not.toHaveBeenCalled();
  });

  it('refuses a malformed payload loudly', async () => {
    await expect(
      sendPayout(deps, { payoutId: 'nope' }, gateway(), ON.accountNumber),
    ).rejects.toThrow(/Malformed payout.send payload/);
  });
});

describe('payout.reconcile', () => {
  const YESTERDAY = new Date('2026-09-27T10:00:00Z');

  /** A captured booking whose owner's share Route moved, with the discharge capture posts. */
  async function capturedWithTransfer(transferPaise = 5100, capturedAt = YESTERDAY) {
    const driver = await seedUser('driver');
    const owner = await seedUser('owner');
    const [space] = await pg.sql<{ id: string }[]>`
      INSERT INTO spaces (owner_id, title, address_line, city, state, pincode, location, zone_id,
                          pricing, schedule, amenities, approval_status)
      VALUES (${owner}, 'Basement', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
              ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geography, 'tdr1w6',
              ${JSON.stringify({ car: { hourlyPaise: 3000 } })}::jsonb,
              ${JSON.stringify({ is24x7: true })}::jsonb, '[]'::jsonb, 'active')
      RETURNING id`;
    const [booking] = await pg.sql<{ id: string }[]>`
      INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at,
                            base_paise, surge_premium_paise, parkease_fee_paise, gst_paise,
                            total_paise, owner_earnings_paise, status)
      VALUES (${driver}, ${space?.id ?? ''}, 'car', 'hourly', now(), now() + interval '2 hours',
              6000, 0, 900, 162, 6162, 5100, 'confirmed')
      RETURNING id`;
    const suffix = `${String(seq)}${String(Math.random()).slice(2, 10)}`;
    const [payment] = await pg.sql<{ id: string }[]>`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at,
                            route_transfer_paise)
      VALUES (${booking?.id ?? ''}, ${driver}, ${`order_${suffix}`}, ${`pay_${suffix}`},
              6162, 6162, 'captured', ${capturedAt.toISOString()}::timestamptz, ${transferPaise})
      RETURNING id`;
    await deps.db.transaction(async (tx) => {
      await postLedger(tx, {
        bookingId: booking?.id ?? '',
        paymentId: payment?.id ?? '',
        entries: routeDischargeEntries(transferPaise, driver),
      });
    });
    return { paymentId: payment?.id ?? '' };
  }

  const clearingFor = async (column: 'payment_id' | 'payout_id', id: string) => {
    const [row] = await pg.sql<{ net: string; debits: string }[]>`
      SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net,
             count(*) FILTER (WHERE direction = 'debit')::text AS debits
      FROM ledger_entries WHERE account = 'settlement_clearing' AND ${pg.sql(column)} = ${id}`;
    return { net: Number(row?.net), debits: Number(row?.debits) };
  };

  const mismatches = () =>
    pg.sql<{ kind: string; reference: string; expected: string | null; actual: string | null }[]>`
      SELECT kind, reference, expected_paise::text AS expected, actual_paise::text AS actual
      FROM reconciliation_mismatches ORDER BY created_at`;

  const transfers = (
    items: { id: string; amountPaise: number; status: string }[],
  ): TransferGateway => ({ forPayment: vi.fn().mockResolvedValue(items) });

  const run = (t: TransferGateway, p: PayoutGateway = gateway()) =>
    reconcilePayouts(deps, { transfers: t, payouts: p, now: MONDAY });

  beforeEach(async () => {
    await pg.sql`TRUNCATE reconciliation_mismatches`;
  });

  it('clears a Route transfer that matches the ledger, once', async () => {
    const { paymentId } = await capturedWithTransfer();
    const t = transfers([{ id: 'trf_QK7l1n', amountPaise: 5100, status: 'processed' }]);

    await run(t);
    await run(t);

    expect(await clearingFor('payment_id', paymentId)).toEqual({ net: 0, debits: 1 });
    expect(await mismatches()).toEqual([]);
  });

  it('flags a transfer whose amount differs, once, logs it at error, and leaves the clearing open', async () => {
    const { paymentId } = await capturedWithTransfer();
    const t = transfers([{ id: 'trf_QK7l1n', amountPaise: 5000, status: 'processed' }]);
    const error = vi.spyOn(logger, 'error');

    await run(t);
    await run(t);

    expect(await mismatches()).toEqual([
      { kind: 'amount_mismatch', reference: paymentId, expected: '5100', actual: '5000' },
    ]);
    expect((await clearingFor('payment_id', paymentId)).net).toBe(5100);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ unresolved: 1 }),
      expect.stringContaining('reconciliation'),
    );
  });

  it('does not ask Razorpay again about a capture it already flagged', async () => {
    await capturedWithTransfer();
    const t = transfers([{ id: 'trf_QK7l1n', amountPaise: 5000, status: 'processed' }]);

    await run(t);
    await run(t);

    expect(t.forPayment).toHaveBeenCalledTimes(1);
  });

  it('flags a transfer still pending three days after capture', async () => {
    const { paymentId } = await capturedWithTransfer(5100, new Date('2026-09-24T10:00:00Z'));

    await run(transfers([{ id: 'trf_QK7l1n', amountPaise: 5100, status: 'pending' }]));

    expect(await mismatches()).toEqual([
      { kind: 'missing_transfer', reference: paymentId, expected: '5100', actual: '0' },
    ]);
  });

  it('asks only about uncleared captures from before today', async () => {
    const eligible = await capturedWithTransfer();
    await capturedWithTransfer(5100, new Date('2026-09-28T01:00:00Z')); // today, IST
    const cleared = await capturedWithTransfer();
    await deps.db.transaction(async (tx) => {
      await postLedger(tx, {
        paymentId: cleared.paymentId,
        entries: settlementClearedEntries(5100),
      });
    });
    const t = transfers([{ id: 'trf_QK7l1n', amountPaise: 5100, status: 'processed' }]);

    await run(t);

    expect(t.forPayment).toHaveBeenCalledTimes(1);
    expect((await clearingFor('payment_id', eligible.paymentId)).net).toBe(0);
  });

  it('reopens a mismatch that recurs after an operator resolved it', async () => {
    const { paymentId } = await capturedWithTransfer();
    const t = transfers([{ id: 'trf_QK7l1n', amountPaise: 5000, status: 'processed' }]);
    await run(t);
    await pg.sql`UPDATE reconciliation_mismatches SET resolved_at = now()`;

    await run(t);

    const rows = await pg.sql<{ resolved: boolean }[]>`
      SELECT resolved_at IS NOT NULL AS resolved FROM reconciliation_mismatches
      WHERE reference = ${paymentId} ORDER BY created_at`;
    expect(rows.map((r) => r.resolved)).toEqual([true, false]);
  });

  it('flags a claim that never reached RazorpayX in a day', async () => {
    const valet = await seedUser('valet');
    await withBank(valet);
    await earn(valet);
    await runWeeklyPayouts(deps, ON);
    const [row] = await payoutsOf(valet);
    await pg.sql`UPDATE payouts SET status = 'processing',
                 initiated_at = ${new Date(MONDAY.getTime() - 2 * 86_400_000).toISOString()}::timestamptz
                 WHERE id = ${row?.id ?? ''}`;

    await run(transfers([]));

    const flagged = await mismatches();
    expect(flagged.map((m) => [m.kind, m.reference])).toEqual([['payout_failed', row?.id]]);
  });

  it('carries on past one failed lookup, then fails the run so it is retried', async () => {
    const first = await capturedWithTransfer();
    const second = await capturedWithTransfer();
    const t: TransferGateway = {
      forPayment: vi
        .fn()
        .mockRejectedValueOnce(new Error('razorpay down'))
        .mockResolvedValue([{ id: 'trf_QK7l1n', amountPaise: 5100, status: 'processed' }]),
    };

    await expect(run(t)).rejects.toThrow(/1 lookup/);

    const nets = [
      (await clearingFor('payment_id', first.paymentId)).net,
      (await clearingFor('payment_id', second.paymentId)).net,
    ];
    expect(nets.sort()).toEqual([0, 5100]); // one cleared, the failed one left open
  });

  it('flags a capture Route never transferred', async () => {
    const { paymentId } = await capturedWithTransfer();

    await run(transfers([]));

    expect(await mismatches()).toEqual([
      { kind: 'missing_transfer', reference: paymentId, expected: '5100', actual: '0' },
    ]);
  });

  it('waits on a transfer Razorpay has not processed yet', async () => {
    const { paymentId } = await capturedWithTransfer();

    await run(transfers([{ id: 'trf_QK7l1n', amountPaise: 5100, status: 'pending' }]));

    expect(await mismatches()).toEqual([]);
    expect((await clearingFor('payment_id', paymentId)).net).toBe(5100);
  });

  async function processingPayout(): Promise<{ valet: string; payoutId: string; net: number }> {
    const valet = await seedUser('valet');
    await withBank(valet);
    const net = await earn(valet);
    await runWeeklyPayouts(deps, ON);
    const [row] = await payoutsOf(valet);
    await sendPayout(deps, { payoutId: row?.id ?? '' }, gateway(), ON.accountNumber);
    return { valet, payoutId: row?.id ?? '', net };
  }

  it('marks a processed RazorpayX payout paid and clears it, once', async () => {
    const { valet, payoutId } = await processingPayout();
    const p = gateway({
      fetch: vi.fn().mockResolvedValue({ id: 'pout_QK7l1nFirst', status: 'processed' }),
    });

    await run(transfers([]), p);
    await run(transfers([]), p);

    expect((await payoutsOf(valet))[0]?.status).toBe('paid');
    expect(await clearingFor('payout_id', payoutId)).toEqual({ net: 0, debits: 1 });
  });

  it('fails a reversed RazorpayX payout and owes the money again', async () => {
    const { valet, net } = await processingPayout();
    const p = gateway({
      fetch: vi.fn().mockResolvedValue({ id: 'pout_QK7l1nFirst', status: 'reversed' }),
    });

    await run(transfers([]), p);

    expect((await payoutsOf(valet))[0]?.status).toBe('failed');
    expect(await owedTo(valet)).toBe(net);
  });
});
