/**
 * The admin panel's refresh token travels in an httpOnly cookie, never in a JSON
 * body a script on the page could read. Three properties do the work:
 *
 *   HttpOnly         — page JavaScript cannot read it, so XSS cannot exfiltrate it.
 *   SameSite=Strict  — it is never sent on a cross-site request, which is the CSRF defence.
 *   Path             — scoped to the admin auth routes, so it is not attached to
 *                      the rest of the API's traffic.
 *
 * `Secure` is the caller's decision (`env.NODE_ENV === 'production'`). It is
 * never derived from the request's Host header, which the client controls.
 */
export const ADMIN_REFRESH_COOKIE = 'pe_admin_rt';
export const ADMIN_COOKIE_PATH = '/api/v1/auth/admin';

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** `randomBytes(32).toString('base64url')` is 43 characters; the range leaves room, not slack. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

function attributes(maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `Path=${ADMIN_COOKIE_PATH}`,
    `Max-Age=${String(maxAgeSeconds)}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeAdminCookie(token: string, opts: { secure: boolean }): string {
  // Tokens are minted by us as base64url, so anything else is a bug, and writing
  // it into a header would be a header-injection hole. Fail loudly instead.
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('refusing to serialise a refresh token that is not base64url');
  }
  return `${ADMIN_REFRESH_COOKIE}=${token}; ${attributes(MAX_AGE_SECONDS, opts.secure)}`;
}

export function clearAdminCookie(opts: { secure: boolean }): string {
  return `${ADMIN_REFRESH_COOKIE}=; ${attributes(0, opts.secure)}`;
}

/**
 * The first `pe_admin_rt` wins — if it is malformed the answer is null, not a
 * hunt for a later, valid duplicate someone else planted.
 */
export function readAdminCookie(header: string | undefined): string | null {
  if (header === undefined || header === '') return null;

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== ADMIN_REFRESH_COOKIE) continue;

    const value = pair.slice(eq + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}
