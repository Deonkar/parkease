import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../src/platform/config/env.schema.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { firebaseStub, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const SESSION = '/api/v1/auth/admin/session';
const REFRESH = '/api/v1/auth/admin/refresh';
const LOGOUT = '/api/v1/auth/admin/logout';

interface Envelope {
  readonly data?: Record<string, unknown>;
  readonly error?: { readonly code: string };
}

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const idem = (): Record<string, string> => ({ 'idempotency-key': crypto.randomUUID() });

/** The admin panel's session endpoints through the real Fastify pipeline, real database. */
describe('admin session HTTP', () => {
  let h: Harness;
  let http: HttpApp;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  /** Seeds a user and points the stubbed Firebase verifier at their phone. */
  const signInAs = async (role: string) => {
    const userId = await seedUser(h, role);
    const rows = await h.sql<{ phone: string }[]>`SELECT phone FROM users WHERE id = ${userId}`;
    const phone = rows[0]?.phone;
    if (phone === undefined) throw new Error('seeded user has no phone');
    firebaseStub.verified = { firebaseUid: `fb-${userId}`, phone };
    return userId;
  };

  const setCookies = (r: { headers: Record<string, unknown> }): string[] => {
    const raw = r.headers['set-cookie'];
    if (raw === undefined) return [];
    return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  };

  const tokenFrom = (cookie: string | undefined): string => {
    const match = /^pe_admin_rt=([A-Za-z0-9_-]+);/.exec(cookie ?? '');
    if (!match?.[1]) throw new Error(`no refresh cookie in: ${String(cookie)}`);
    return match[1];
  };

  const login = async () => {
    const userId = await signInAs('admin');
    const res = await http.request({
      method: 'POST',
      url: SESSION,
      payload: { idToken: 'stubbed' },
      headers: idem(),
    });
    expect(res.status).toBe(201);
    return { userId, res, token: tokenFrom(setCookies(res)[0]) };
  };

  const post = (url: string, token: string | null, headers: Record<string, string> = idem()) =>
    http.request({
      method: 'POST',
      url,
      payload: {},
      headers: { ...headers, ...(token === null ? {} : { cookie: `pe_admin_rt=${token}` }) },
    });

  const liveTokens = async (userId: string): Promise<number> => {
    const rows = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM refresh_tokens
      WHERE user_id = ${userId} AND revoked_at IS NULL`;
    return rows[0]?.n ?? -1;
  };

  it('a non-admin is refused with 403 and no refresh token survives', async () => {
    const userId = await signInAs('driver');

    const res = await http.request({
      method: 'POST',
      url: SESSION,
      payload: { idToken: 'stubbed' },
      headers: idem(),
    });

    expect(res.status).toBe(403);
    expect(envelope(res).error?.code).toBe('ADMIN_ROLE_REQUIRED');
    expect(setCookies(res)).toHaveLength(0);
    expect(await liveTokens(userId)).toBe(0);
    const all = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = ${userId}`;
    expect(all[0]?.n).toBe(0);
  });

  it('an admin gets 201, an httpOnly cookie, and a body with no refresh token', async () => {
    const { res, token } = await login();

    const cookie = setCookies(res)[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth/admin');
    expect(cookie).toContain('Max-Age=604800');

    const data = envelope(res).data ?? {};
    expect(data).toMatchObject({ expiresIn: 900, activeRole: 'admin' });
    expect(typeof data['accessToken']).toBe('string');
    expect(data).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it('refresh rotates the row and sets a new cookie; the old cookie is then reuse and kills the family', async () => {
    const { userId, token: old } = await login();

    const refreshed = await post(REFRESH, old);
    expect(refreshed.status).toBe(200);
    const next = tokenFrom(setCookies(refreshed)[0]);
    expect(next).not.toBe(old);
    expect(envelope(refreshed).data).toMatchObject({ expiresIn: 900 });
    expect(envelope(refreshed).data).not.toHaveProperty('refreshToken');

    const oldRow = await h.sql<{ rotated_at: Date | null }[]>`
      SELECT rotated_at FROM refresh_tokens WHERE token_hash = ${sha256(old)}`;
    expect(oldRow[0]?.rotated_at).not.toBeNull();

    const replayed = await post(REFRESH, old);
    expect(replayed.status).toBe(401);

    expect(await liveTokens(userId)).toBe(0);
    // ...including the token the legitimate holder was just given.
    expect((await post(REFRESH, next)).status).toBe(401);
  });

  it('refresh without a cookie is 401', async () => {
    expect((await post(REFRESH, null)).status).toBe(401);
  });

  it('refresh by an admin whose role was withdrawn is 403 and the revocation committed', async () => {
    const { userId, token } = await login();
    await h.sql`UPDATE user_roles SET status = 'suspended' WHERE user_id = ${userId}`;

    const res = await post(REFRESH, token);

    expect(res.status).toBe(403);
    expect(envelope(res).error?.code).toBe('ADMIN_ROLE_REQUIRED');
    const row = await h.sql<{ revoked_reason: string | null }[]>`
      SELECT revoked_reason FROM refresh_tokens WHERE token_hash = ${sha256(token)}`;
    expect(row[0]?.revoked_reason).toBe('role_revoked');
  });

  it('logout is 204, clears the cookie and revokes the row', async () => {
    const { token } = await login();

    const res = await post(LOGOUT, token);

    expect(res.status).toBe(204);
    const cookie = setCookies(res)[0] ?? '';
    expect(cookie).toContain('pe_admin_rt=;');
    expect(cookie).toContain('Max-Age=0');
    const row = await h.sql<{ revoked_reason: string | null }[]>`
      SELECT revoked_reason FROM refresh_tokens WHERE token_hash = ${sha256(token)}`;
    expect(row[0]?.revoked_reason).toBe('logout');
  });

  it('logout with no cookie is still 204 and clears', async () => {
    const res = await post(LOGOUT, null);

    expect(res.status).toBe(204);
    expect(setCookies(res)[0]).toContain('Max-Age=0');
  });

  /**
   * SEC-M2 (task 18a review). CORS lets credentialed requests through from every configured
   * origin, the marketing site included, and SameSite=Strict does not separate same-site
   * subdomains. So an XSS on the web origin could POST /auth/admin/refresh with credentials and
   * read an admin access token. With ADMIN_ORIGIN set, only that origin may reach these routes.
   */
  describe('admin origin', () => {
    const ADMIN = 'https://admin.parkease.test';
    const WEB = 'https://www.parkease.test';
    let saved: string | undefined;

    beforeEach(() => {
      saved = env.ADMIN_ORIGIN;
      env.ADMIN_ORIGIN = ADMIN;
    });
    afterEach(() => {
      env.ADMIN_ORIGIN = saved;
    });

    /** Signs in with no origin check, then turns the check on for the request under test. */
    const loginUnchecked = async () => {
      env.ADMIN_ORIGIN = undefined;
      const session = await login();
      env.ADMIN_ORIGIN = ADMIN;
      return session;
    };

    const refreshFrom = async (origin: string | null) => {
      const { token } = await loginUnchecked();
      return post(REFRESH, token, { ...idem(), ...(origin === null ? {} : { origin }) });
    };

    it('the web origin is refused 403 ORIGIN_NOT_ALLOWED and gets no token', async () => {
      const res = await refreshFrom(WEB);
      expect(res.status).toBe(403);
      expect(envelope(res).error?.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
      expect(setCookies(res)).toHaveLength(0);
    });

    it('a request with no Origin is refused once ADMIN_ORIGIN is set', async () => {
      const res = await refreshFrom(null);
      expect(res.status).toBe(403);
      expect(envelope(res).error?.code).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('the admin origin is served', async () => {
      const res = await refreshFrom(ADMIN);
      expect(res.status).toBe(200);
      expect(setCookies(res)).toHaveLength(1);
    });

    it('session and logout are behind the same check', async () => {
      const { token } = await loginUnchecked();
      const session = await http.request({
        method: 'POST',
        url: SESSION,
        payload: { idToken: 'stubbed' },
        headers: { ...idem(), origin: WEB },
      });
      expect(session.status).toBe(403);
      expect((await post(LOGOUT, token, { ...idem(), origin: WEB })).status).toBe(403);
    });
  });

  it('an idempotent replay is bound to the cookie: same cookie replays, another or none is 422', async () => {
    const { token } = await login();
    const headers = idem();

    const first = await post(REFRESH, token, headers);
    expect(first.status).toBe(200);
    // Let the interceptor's detached store write land before replaying.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const replay = await post(REFRESH, token, headers);
    expect(replay.status).toBe(200);
    expect(setCookies(replay)).toHaveLength(0);

    const other = await post(REFRESH, 'o'.repeat(43), headers);
    expect(other.status).toBe(422);
    expect(JSON.stringify(other.body)).not.toContain('accessToken');

    const none = await post(REFRESH, null, headers);
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.body)).not.toContain('accessToken');
  });
});
