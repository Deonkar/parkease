import { computeValetLegFee, valetLegEntries } from '@parkease/contracts/money';
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
import { type PayoutGateway, RazorpayXError } from '../../src/jobs/payout/razorpayx.js';
import { runWeeklyPayouts } from '../../src/jobs/payout/run-weekly.job.js';
import { sendPayout } from '../../src/jobs/payout/send.job.js';

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
