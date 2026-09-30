import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RazorpayApiError } from '../../src/domains/payout/razorpay-rest.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const FORM = {
  legalName: 'Priya Sharma',
  email: 'priya@example.in',
  pan: 'ABCPS1234K',
  street: '12, 5th Cross, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560038',
  accountNumber: '50100123456789',
  ifsc: 'HDFC0001234',
};

/**
 * Route Linked Account onboarding over HTTP (task 16b). The Route client is the only double:
 * it is the network. Each Razorpay step's id is saved before the next call, so a failure
 * part-way resumes instead of creating a second account.
 */
describe('/me/route-onboarding over HTTP (task 16b)', () => {
  let h: Harness;
  let http: HttpApp;
  let ownerId: string;
  const route = {
    upsertAccount: vi.fn(),
    upsertStakeholder: vi.fn(),
    requestProduct: vi.fn(),
    configureSettlement: vi.fn(),
  };

  const as = (id: string, role: string) => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };
  const put = (body: unknown = FORM) =>
    http.request({
      method: 'PUT',
      url: '/api/v1/me/route-onboarding',
      payload: body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
  const get = () => http.request({ method: 'GET', url: '/api/v1/me/route-onboarding' });
  const row = async () => {
    const [r] = await h.sql<
      Record<string, unknown>[]
    >`SELECT * FROM linked_accounts WHERE user_id = ${ownerId}`;
    return r;
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, undefined, undefined, route);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE linked_accounts, idempotency_keys`;
    vi.clearAllMocks();
    route.upsertAccount.mockResolvedValue('acc_QK7l1nOwner');
    route.upsertStakeholder.mockResolvedValue('sth_QK7l1nOwner');
    route.requestProduct.mockResolvedValue('acc_prd_QK7l1nRoute');
    route.configureSettlement.mockResolvedValue({ status: 'under_review', requirements: [] });
    ownerId = await seedUser(h, 'owner');
    as(ownerId, 'owner');
  });

  it('creates account, stakeholder, product and settlement in order, and answers the view', async () => {
    const response = await put();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        status: 'under_review',
        legalName: 'Priya Sharma',
        bankLast4: '6789',
        ifscPrefix: 'HDFC',
        requirements: [],
      },
    });
    expect(route.upsertAccount).toHaveBeenCalledWith(null, {
      email: 'priya@example.in',
      phone: expect.stringMatching(/^\d{8,15}$/) as string,
      legalName: 'Priya Sharma',
      category: 'transport',
      subcategory: 'parking_lots_and_garages',
      street: '12, 5th Cross, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560038',
      referenceId: ownerId,
    });
    expect(route.upsertStakeholder).toHaveBeenCalledWith('acc_QK7l1nOwner', null, {
      name: 'Priya Sharma',
      email: 'priya@example.in',
      pan: 'ABCPS1234K',
    });
    expect(route.requestProduct).toHaveBeenCalledWith('acc_QK7l1nOwner');
    expect(route.configureSettlement).toHaveBeenCalledWith(
      'acc_QK7l1nOwner',
      'acc_prd_QK7l1nRoute',
      {
        accountNumber: '50100123456789',
        ifsc: 'HDFC0001234',
        beneficiaryName: 'Priya Sharma',
      },
    );
    expect(await row()).toMatchObject({
      razorpay_account_id: 'acc_QK7l1nOwner',
      razorpay_stakeholder_id: 'sth_QK7l1nOwner',
      razorpay_product_id: 'acc_prd_QK7l1nRoute',
      kyc_status: 'under_review',
    });
  });

  it('never stores the PAN or the full account number', async () => {
    await put();

    const stored = JSON.stringify(await row());
    expect(stored).not.toContain('ABCPS1234K');
    expect(stored).not.toContain('50100123456789');
  });

  it('files a washer under car washes', async () => {
    as(ownerId, 'washer');
    await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${ownerId}, 'washer')`;

    await put();

    expect(route.upsertAccount).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ category: 'services', subcategory: 'car_washes' }),
    );
  });

  it('resumes after a failed step instead of creating a second account', async () => {
    route.upsertStakeholder.mockRejectedValueOnce(new RazorpayApiError(503, 'down'));

    expect((await put()).status).toBe(503);
    expect(await row()).toMatchObject({
      razorpay_account_id: 'acc_QK7l1nOwner',
      kyc_status: 'pending',
    });

    expect((await put()).status).toBe(200);
    expect(route.upsertAccount).toHaveBeenLastCalledWith('acc_QK7l1nOwner', expect.anything());
    expect(route.upsertAccount.mock.calls.filter(([id]) => id === null)).toHaveLength(1);
  });

  it('shows what Razorpay asked about, and a resubmission updates rather than recreates', async () => {
    route.configureSettlement.mockResolvedValueOnce({
      status: 'needs_clarification',
      requirements: [{ field: 'settlements.beneficiary_name', reason: 'field_mismatch' }],
    });
    await put();

    const view = await get();
    expect(view.body).toMatchObject({
      data: {
        status: 'needs_clarification',
        requirements: [{ field: 'settlements.beneficiary_name', reason: 'field_mismatch' }],
      },
    });

    expect((await put({ ...FORM, legalName: 'Priya R Sharma' })).status).toBe(200);
    expect(route.upsertAccount).toHaveBeenLastCalledWith('acc_QK7l1nOwner', expect.anything());
    expect(route.upsertStakeholder).toHaveBeenLastCalledWith(
      'acc_QK7l1nOwner',
      'sth_QK7l1nOwner',
      expect.objectContaining({ name: 'Priya R Sharma' }),
    );
    expect(route.requestProduct).toHaveBeenCalledTimes(1);
  });

  it('refuses a resubmission while under review or once active', async () => {
    await put();

    const again = await put();

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'ROUTE_ONBOARDING_LOCKED' } });
  });

  it('answers 422 when Razorpay refuses the details, keeping what was saved', async () => {
    route.upsertStakeholder.mockRejectedValueOnce(new RazorpayApiError(400, 'invalid pan'));

    const response = await put();

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: { code: 'ROUTE_DETAILS_REJECTED' } });
    expect(await row()).toMatchObject({ razorpay_account_id: 'acc_QK7l1nOwner' });
  });

  it('keeps the old bank on screen when Razorpay refuses the new one', async () => {
    route.configureSettlement.mockRejectedValueOnce(new RazorpayApiError(400, 'bad account'));

    expect((await put()).status).toBe(422);
    expect(await row()).toMatchObject({ settlement_last4: null, legal_name: null });
  });

  it('never undoes an activation that landed while the settlement call was in flight', async () => {
    route.configureSettlement.mockImplementationOnce(async () => {
      await h.sql`UPDATE linked_accounts SET kyc_status = 'activated',
        route_status_at = now() + interval '1 second' WHERE user_id = ${ownerId}`;
      return { status: 'under_review', requirements: [] };
    });

    expect((await put()).status).toBe(200);
    expect(await row()).toMatchObject({ kyc_status: 'activated', settlement_last4: '6789' });
  });

  it('files a washer acting in another role under car washes, not parking', async () => {
    await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${ownerId}, 'washer')`;
    actingAs.user = { id: ownerId, roles: ['washer', 'driver'], activeRole: 'driver' };

    await put();

    expect(route.upsertAccount).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ category: 'services', subcategory: 'car_washes' }),
    );
  });

  it('rejects a malformed PAN with 400 before calling Razorpay', async () => {
    expect((await put({ ...FORM, pan: 'abc' })).status).toBe(400);
    expect(route.upsertAccount).not.toHaveBeenCalled();
  });

  it('is 404 before any submission', async () => {
    expect((await get()).status).toBe(404);
  });

  it.each(['valet', 'driver'])('is refused to a %s with 403', async (role) => {
    as(await seedUser(h, role), role);
    expect((await put()).status).toBe(403);
    expect((await get()).status).toBe(403);
  });

  describe('the product.route.* webhook', () => {
    /** Razorpay's clock, whole seconds: a minute ahead, so it is after any submit here. */
    const T = Math.floor(Date.now() / 1000) + 60;
    const event = (name: string, status: string, requirements: unknown[] = [], createdAt = T) =>
      JSON.stringify({
        entity: 'event',
        created_at: createdAt,
        event: name,
        payload: {
          account_id: 'acc_QK7l1nOwner',
          merchant_product: {
            entity: { id: 'acc_prd_QK7l1nRoute', activation_status: status, requirements },
          },
        },
      });
    const deliver = (body: string, eventId: string) => {
      actingAs.user = null;
      return http.request({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        rawPayload: body,
        headers: {
          'x-razorpay-signature': createHmac('sha256', 'fake_webhook_secret_000')
            .update(Buffer.from(body, 'utf8'))
            .digest('hex'),
          'x-razorpay-event-id': eventId,
        },
      });
    };
    const notifications = async () =>
      (
        await h.sql<{ template: string }[]>`
          SELECT payload->>'template' AS template FROM outbox_messages
          WHERE type = 'notification.dispatch' ORDER BY created_at`
      ).map((n) => n.template);

    beforeEach(async () => {
      await h.sql`TRUNCATE outbox_messages`;
      await put();
    });

    it('activates the account, and tells the owner once across different deliveries', async () => {
      expect(
        (await deliver(event('product.route.activated', 'activated'), 'evt_act_1')).status,
      ).toBe(200);
      expect(
        (await deliver(event('product.route.activated', 'activated'), 'evt_act_2')).status,
      ).toBe(200);

      expect(await row()).toMatchObject({ kyc_status: 'activated' });
      expect(await notifications()).toEqual(['payout.route_activated']);
    });

    it('ignores an older event that arrives late, rather than undoing activation', async () => {
      await deliver(event('product.route.activated', 'activated', [], T + 20), 'evt_act');
      await deliver(event('product.route.under_review', 'under_review', [], T + 10), 'evt_late');

      expect(await row()).toMatchObject({ kyc_status: 'activated' });
      expect(await notifications()).toEqual(['payout.route_activated']);
    });

    it('refreshes what Razorpay needs when a newer event keeps the status, telling the owner once', async () => {
      const nc = (field: string, at: number, id: string) =>
        deliver(
          event(
            'product.route.needs_clarification',
            'needs_clarification',
            [{ field_reference: field, reason_code: 'document_invalid' }],
            at,
          ),
          id,
        );
      await nc('kyc.pan', T + 10, 'evt_nc_a');
      await nc('settlements.account_number', T + 20, 'evt_nc_b');

      expect(await row()).toMatchObject({
        requirements: [{ field: 'settlements.account_number', reason: 'document_invalid' }],
      });
      expect(await notifications()).toEqual(['payout.route_needs_clarification']);
    });

    it('rejects a route event with no created_at: status writes are ordered by it', async () => {
      const undated = JSON.parse(event('product.route.activated', 'activated')) as Record<
        string,
        unknown
      >;
      delete undated.created_at;

      expect((await deliver(JSON.stringify(undated), 'evt_undated')).status).toBe(400);
    });

    it.each([
      ['under_review then activated', 'under_review', 'activated'],
      ['activated then under_review', 'activated', 'under_review'],
    ])(
      'activates on %s in the same second: a tie goes to the later lifecycle step',
      async (_order, first, second) => {
        await deliver(event(`product.route.${first}`, first, [], T + 10), 'evt_tie_1');
        await deliver(event(`product.route.${second}`, second, [], T + 10), 'evt_tie_2');

        expect(await row()).toMatchObject({ kyc_status: 'activated' });
      },
    );

    it.each([
      ['rejected', ['payout.route_rejected']],
      ['suspended', ['payout.route_suspended']],
      ['under_review', []],
    ])('tells the owner about %s as its own template, or not at all', async (status, sent) => {
      await deliver(event(`product.route.${status}`, status, [], T + 10), `evt_${status}`);

      expect(await row()).toMatchObject({ kyc_status: status });
      expect(await notifications()).toEqual(sent);
    });

    it('records what Razorpay needs clarified', async () => {
      await deliver(
        event('product.route.needs_clarification', 'needs_clarification', [
          { field_reference: 'kyc.pan', reason_code: 'document_invalid' },
        ]),
        'evt_nc_1',
      );

      as(ownerId, 'owner');
      expect((await get()).body).toMatchObject({
        data: {
          status: 'needs_clarification',
          requirements: [{ field: 'kyc.pan', reason: 'document_invalid' }],
        },
      });
      expect(await notifications()).toEqual(['payout.route_needs_clarification']);
    });

    it('answers 200 for an account it does not know, rather than being retried forever', async () => {
      const unknown = event('product.route.activated', 'activated').replace(
        'acc_QK7l1nOwner',
        'acc_QK7l1nNobody',
      );

      expect((await deliver(unknown, 'evt_unknown')).status).toBe(200);
      expect(await row()).toMatchObject({ kyc_status: 'under_review' });
    });

    it('rejects a malformed activation instead of treating it as unhandled', async () => {
      const bad = JSON.stringify({
        entity: 'event',
        event: 'product.route.activated',
        payload: { merchant_product: { entity: {} } },
      });

      expect((await deliver(bad, 'evt_bad')).status).toBe(400);
    });
  });
});
