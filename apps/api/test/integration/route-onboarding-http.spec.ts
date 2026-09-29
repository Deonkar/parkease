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
});
