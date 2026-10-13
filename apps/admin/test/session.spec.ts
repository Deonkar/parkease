import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/report', () => ({ reportError: vi.fn() }));

const { exchangeIdToken, userFromToken } = await import('../src/lib/session');

const b64url = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (claims: object): string => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

const ADMIN_ID = '0192f000-0000-7000-8000-000000000005';

// The API's /auth/admin/session body, exactly: tokens and roles, no `user` (task 22: the panel
// expected a `user` object the API never sent, so every real sign-in failed).
const sessionBody = (accessToken: string) => ({
  data: { accessToken, expiresIn: 900, roles: ['admin'], activeRole: 'admin', isNewUser: false },
});

describe('admin session', () => {
  it('signs in from the body the API actually returns', async () => {
    const access = token({ sub: ADMIN_ID, roles: ['admin'], active_role: 'admin' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(sessionBody(access)), { status: 201 })),
      ),
    );

    await expect(exchangeIdToken('demo:+919900000005')).resolves.toBe(true);
  });

  it('reads the user from the token claims', () => {
    expect(userFromToken(token({ sub: ADMIN_ID, roles: ['admin'] }))).toEqual({
      id: ADMIN_ID,
      roles: ['admin'],
    });
  });

  it('refuses a token whose claims do not parse', () => {
    expect(userFromToken(token({ sub: 'not-a-uuid', roles: ['admin'] }))).toBeNull();
    expect(userFromToken('garbage')).toBeNull();
  });
});
