import type { AuthUser } from '../auth/current-user.decorator.js';
import type { TokenService } from '../auth/token.service.js';

/**
 * The handshake shape we accept a token from.
 *
 * Declared structurally rather than as socket.io's `Handshake` so this stays
 * testable without a server and so the module's dependency on socket.io is zero
 * imports wide.
 */
export interface TokenCarryingHandshake {
  readonly auth?: Record<string, unknown> | undefined;
  readonly headers?: Record<string, string | string[] | undefined> | undefined;
}

/**
 * A socket's token, from `auth.token` or the Authorization header.
 *
 * `auth` first, because it is the only one a browser client controls: the
 * WebSocket API has no way to set a request header, so a web driver watching
 * their car can authenticate exactly one way. The header form is accepted for
 * native clients and for probes.
 */
export function extractHandshakeToken(handshake: TokenCarryingHandshake): string | null {
  const fromAuth = handshake.auth?.['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth.startsWith('Bearer ') ? fromAuth.slice(7) : fromAuth;
  }

  const header = handshake.headers?.['authorization'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'string' && raw.startsWith('Bearer ')) {
    const token = raw.slice(7);
    return token.length > 0 ? token : null;
  }

  return null;
}

/**
 * Authenticates a socket with the same access token as REST — the same
 * `TokenService`, the same signing key, the same expiry.
 *
 * A socket is not a second authentication system. Every place this project has
 * ever had two ways to establish who you are, one of them has drifted; here the
 * only difference is where the token was carried, never how it is trusted.
 *
 * Returns `null` rather than throwing, because the caller's failure mode is to
 * disconnect the socket, not to render an HTTP status.
 */
export async function authenticateHandshake(
  tokens: Pick<TokenService, 'verifyAccessToken'>,
  handshake: TokenCarryingHandshake,
): Promise<AuthUser | null> {
  const token = extractHandshakeToken(handshake);
  if (token === null) return null;

  try {
    const payload = await tokens.verifyAccessToken(token);
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;

    return {
      id: payload.sub,
      roles: payload.roles,
      activeRole: payload.active_role ?? null,
    };
  } catch {
    /**
     * Expired, tampered, wrong algorithm, or a refresh token presented in an
     * access token's place — a refresh token is 32 random bytes, not a JWT, so
     * `jwtVerify` rejects it here rather than anywhere clever.
     *
     * Deliberately not logged: a failed handshake is routine (an expired token
     * on a backgrounded phone), and the token itself must never reach a log line
     * (R-SEC-03). The caller emits an UNAUTHORIZED frame and disconnects, which
     * is the observable signal (R-FAIL-01 — handled, not swallowed).
     */
    return null;
  }
}
