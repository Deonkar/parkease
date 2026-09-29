import { payoutEntries } from '@parkease/contracts/money';
import { toPaise } from '@parkease/contracts/primitives';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LedgerService } from '../../src/domains/ledger/ledger.service.js';
import { RazorpayXError } from '../../src/domains/payout/razorpayx.client.js';
import { decryptField } from '../../src/platform/crypto/aes-gcm.js';
import { withTransaction } from '../../src/platform/db/transaction.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const ACCOUNT = '50100123456789';
const BODY = { accountHolderName: 'Priya Sharma', accountNumber: ACCOUNT, ifscCode: 'HDFC0001234' };

/**
 * `/me/bank-details` and `/me/payouts` through the real Fastify pipeline: the
 * idempotency interceptor, the role guards, the envelope and the filter. The
 * RazorpayX double is the only thing faked — it is the network.
 */
describe('/me bank details and payouts over HTTP (task 16a)', () => {
  let h: Harness;
  let http: HttpApp;
  let valetId: string;
  const razorpayx = {
    createContact: vi.fn(),
    createFundAccount: vi.fn(),
  };

  const as = (id: string, role: string) => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };

  const put = (body: unknown = BODY, key: string | null = crypto.randomUUID()) =>
    http.request({
      method: 'PUT',
      url: '/api/v1/me/bank-details',
      payload: body,
      headers: key === null ? {} : { 'idempotency-key': key },
    });

  const get = (url: string) => http.request({ method: 'GET', url });

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, undefined, razorpayx);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE ledger_entries, payouts, bank_details, idempotency_keys,
                         outbox_messages, audit_log`;
    vi.clearAllMocks();
    razorpayx.createContact.mockResolvedValue('cont_QK7l1nValet');
    razorpayx.createFundAccount.mockResolvedValue('fa_QK7l1nFirst');
    valetId = await seedUser(h, 'valet');
    as(valetId, 'valet');
  });

  describe('PUT /me/bank-details', () => {
    it('needs an Idempotency-Key', async () => {
      expect((await put(BODY, null)).status).toBe(400);
    });

    it('rejects a malformed IFSC with 400 and never calls RazorpayX', async () => {
      const response = await put({ ...BODY, ifscCode: 'hdfc0001234' });

      expect(response.status).toBe(400);
      expect(razorpayx.createContact).not.toHaveBeenCalled();
    });

    it('stores the details encrypted and answers masked', async () => {
      const response = await put();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: {
          accountHolderName: 'Priya Sharma',
          accountNumberLast4: '6789',
          ifscPrefix: 'HDFC',
          updatedAt: expect.any(String) as string,
        },
      });
      expect(JSON.stringify(response.body)).not.toContain(ACCOUNT);

      const [row] = await h.sql<
        { acc: string; ifsc: string; contact: string; fa: string }[]
      >`SELECT account_number_encrypted AS acc, ifsc_encrypted AS ifsc,
               razorpayx_contact_id AS contact, razorpayx_fund_account_id AS fa
        FROM bank_details WHERE user_id = ${valetId}`;
      expect(row?.acc).not.toContain(ACCOUNT);
      expect(decryptField(row?.acc ?? '')).toBe(ACCOUNT);
      expect(decryptField(row?.ifsc ?? '')).toBe('HDFC0001234');
      expect(row).toMatchObject({ contact: 'cont_QK7l1nValet', fa: 'fa_QK7l1nFirst' });
      expect(razorpayx.createContact).toHaveBeenCalledWith({
        name: 'Priya Sharma',
        referenceId: valetId,
      });
      expect(razorpayx.createFundAccount).toHaveBeenCalledWith({
        contactId: 'cont_QK7l1nValet',
        name: 'Priya Sharma',
        ifsc: 'HDFC0001234',
        accountNumber: ACCOUNT,
      });
    });

    it('answers a replay from the stored response without calling RazorpayX again', async () => {
      const key = crypto.randomUUID();
      const first = await put(BODY, key);
      const second = await put(BODY, key);

      expect(second).toEqual(first);
      expect(razorpayx.createFundAccount).toHaveBeenCalledTimes(1);
    });

    it('on a change: reuses the contact, replaces the fund account, cancels pending payouts, audits and notifies', async () => {
      await put();
      // A payout already posted to the ledger and waiting to be sent.
      const posting = payoutEntries(toPaise(20_000), valetId, new Date());
      const txnId = crypto.randomUUID();
      await withTransaction(h.db, async (tx) => {
        await new LedgerService().post(tx, { txnId, entries: posting.entries });
      });
      await h.sql`INSERT INTO payouts (user_id, period, gross_paise, net_paise, txn_id, status)
                  VALUES (${valetId}, '2026-W40', 20000, 20000, ${txnId}, 'pending')`;
      razorpayx.createFundAccount.mockResolvedValue('fa_QK7l1nSecond');

      const response = await put({
        ...BODY,
        accountNumber: '60200987654321',
        ifscCode: 'ICIC0009876',
      });

      expect(response.status).toBe(200);
      expect(razorpayx.createContact).toHaveBeenCalledTimes(1);
      const [bank] = await h.sql<{ fa: string }[]>`
        SELECT razorpayx_fund_account_id AS fa FROM bank_details WHERE user_id = ${valetId}`;
      expect(bank?.fa).toBe('fa_QK7l1nSecond');

      const [payout] = await h.sql<{ status: string }[]>`SELECT status FROM payouts`;
      expect(payout?.status).toBe('cancelled');
      // The payout's posting is reversed, so the valet is owed the money again.
      const [owed] = await h.sql<{ net: string }[]>`
        SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net
        FROM ledger_entries WHERE account = 'owner_payable' AND counterparty_user_id = ${valetId}`;
      expect(owed?.net).toBe('0');
      const [clearing] = await h.sql<{ net: string }[]>`
        SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net
        FROM ledger_entries WHERE account = 'settlement_clearing'`;
      expect(clearing?.net).toBe('0');

      const audit = await h.sql<{ before: unknown; after: unknown }[]>`
        SELECT before, after FROM audit_log WHERE action = 'bank_details.update' ORDER BY created_at`;
      expect(audit).toHaveLength(2);
      expect(audit[1]?.before).toBeNull();
      expect(audit[1]?.after).toEqual({ last4: '4321', cancelledPayouts: 1 });

      const notes = await h.sql<{ template: string }[]>`
        SELECT payload->>'template' AS template FROM outbox_messages
        WHERE type = 'notification.dispatch' ORDER BY created_at, id`;
      expect(notes.map((n) => n.template)).toEqual([
        'payout.bank_details_updated',
        'payout.bank_details_updated',
        'payout.bank_changed',
      ]);
    });

    it('writes nothing and answers 503 when RazorpayX is unreachable', async () => {
      razorpayx.createFundAccount.mockRejectedValue(new RazorpayXError(null, 'network down'));

      const response = await put();

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ error: { code: 'PAYOUT_PROVIDER_UNAVAILABLE' } });
      const [count] = await h.sql<{ n: string }[]>`SELECT count(*)::text AS n FROM bank_details`;
      expect(count?.n).toBe('0');
    });

    it('answers 422 when RazorpayX rejects the account', async () => {
      razorpayx.createFundAccount.mockRejectedValue(new RazorpayXError(400, 'invalid ifsc'));

      const response = await put();

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'BANK_DETAILS_REJECTED' } });
    });

    it('is refused to a driver with 403', async () => {
      as(await seedUser(h, 'driver'), 'driver');
      expect((await put()).status).toBe(403);
      expect((await get('/api/v1/me/bank-details')).status).toBe(403);
      expect((await get('/api/v1/me/payouts')).status).toBe(403);
    });
  });

  describe('GET /me/bank-details', () => {
    it('is 404 before any are saved, and only ever the caller’s own', async () => {
      expect((await get('/api/v1/me/bank-details')).status).toBe(404);

      await put();
      as(await seedUser(h, 'owner'), 'owner');
      expect((await get('/api/v1/me/bank-details')).status).toBe(404);
    });

    it('returns the masked view', async () => {
      await put();
      const response = await get('/api/v1/me/bank-details');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { accountNumberLast4: '6789', ifscPrefix: 'HDFC' },
      });
      expect(JSON.stringify(response.body)).not.toContain(ACCOUNT);
    });
  });

  describe('GET /me/payouts', () => {
    const seedPayout = async (userId: string, period: string, netPaise: number) => {
      const [row] = await h.sql<{ id: string }[]>`
        INSERT INTO payouts (user_id, period, gross_paise, net_paise, txn_id, status)
        VALUES (${userId}, ${period}, ${netPaise}, ${netPaise}, gen_random_uuid(), 'paid')
        RETURNING id`;
      return row?.id ?? '';
    };

    it('lists only the caller’s payouts, newest first, and pages to the end', async () => {
      const other = await seedUser(h, 'valet');
      await seedPayout(other, '2026-W38', 99_900);
      const ids = [
        await seedPayout(valetId, '2026-W38', 10_000),
        await seedPayout(valetId, '2026-W39', 20_000),
        await seedPayout(valetId, '2026-W40', 30_000),
      ];

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const url: string =
          cursor === null
            ? '/api/v1/me/payouts?limit=2'
            : `/api/v1/me/payouts?limit=2&cursor=${cursor}`;
        const response = await get(url);
        expect(response.status).toBe(200);
        const body = response.body as {
          data: { id: string }[];
          meta: { nextCursor: string | null };
        };
        seen.push(...body.data.map((p) => p.id));
        cursor = body.meta.nextCursor;
      } while (cursor !== null);

      expect(seen).toEqual([...ids].reverse());
    });

    it('shows one payout with its tax split, and 404s someone else’s', async () => {
      const mine = await seedPayout(valetId, '2026-W40', 30_000);
      const theirs = await seedPayout(await seedUser(h, 'valet'), '2026-W40', 99_900);

      const response = await get(`/api/v1/me/payouts/${mine}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          id: mine,
          period: '2026-W40',
          grossPaise: 30_000,
          tcsPaise: 0,
          tdsPaise: 0,
          netPaise: 30_000,
          status: 'paid',
        },
      });

      expect((await get(`/api/v1/me/payouts/${theirs}`)).status).toBe(404);
    });
  });
});
