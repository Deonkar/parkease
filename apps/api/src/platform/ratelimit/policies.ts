export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly keyBy: 'user' | 'ip' | 'phone';
  readonly failClosed?: boolean;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<string, RateLimitPolicy>> = {
  'POST /api/v1/auth/session:phone': {
    limit: 10,
    windowSeconds: 3600,
    keyBy: 'phone',
    failClosed: true,
  },
  'POST /api/v1/auth/session:ip': { limit: 30, windowSeconds: 3600, keyBy: 'ip', failClosed: true },
  'POST /api/v1/auth/refresh': { limit: 30, windowSeconds: 3600, keyBy: 'user', failClosed: true },
  'GET /api/v1/driver/spaces': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/driver/spaces/:id': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/driver/quotes': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/bookings': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/driver/bookings': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/driver/bookings/:id': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/bookings/:id/cancel': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/bookings/:id/extend': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/bookings/:id/check-in': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/owner/bookings/:id/check-in': { limit: 30, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/payments/orders': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/payments/verify': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  // Razorpay's own range, per security.md §4.3. Keyed by IP because there is no
  // user to key by, and `failClosed` is deliberately absent: dropping a capture
  // event because Redis blinked is worse than serving it.
  'POST /api/v1/webhooks/razorpay': { limit: 300, windowSeconds: 60, keyBy: 'ip' },
  'POST /api/v1/valet/jobs/:id/accept': { limit: 30, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/owner/spaces': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'PUT /api/v1/owner/spaces/:id': { limit: 20, windowSeconds: 60, keyBy: 'user' },
  'DELETE /api/v1/owner/spaces/:id': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/owner/spaces/:id/photos': { limit: 20, windowSeconds: 60, keyBy: 'user' },
  'PATCH /api/v1/owner/spaces/:id/toggle': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/owner/spaces': { limit: 60, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/uploads': { limit: 20, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/me/roles/active': { limit: 10, windowSeconds: 60, keyBy: 'user' },

  // Surge admin (task 10 §10.4). Tighter than `ADMIN:*` in both directions, and
  // for different reasons.
  //
  // The reads are a config screen, not a dashboard that polls: `GET /zones`
  // fans out to one MGET across every override, so a tab left refreshing is a
  // load the cache feels. 30/min is generous for a human and cheap to bound.
  //
  // The writes are the reason this endpoint is audited at all. One of them
  // changes what every driver in a cell pays, and there is no legitimate flow
  // that issues more than a handful a minute. Keeping them well under the
  // generic admin budget means a stolen admin token cannot rewrite the price of
  // the whole city faster than an operator can notice — the rate limit is the
  // blast-radius control that the audit row can only describe after the fact.
  'GET /api/v1/admin/surge/config': { limit: 30, windowSeconds: 60, keyBy: 'user' },
  'PUT /api/v1/admin/surge/config': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'GET /api/v1/admin/surge/zones': { limit: 30, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/admin/surge/zones': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'PATCH /api/v1/admin/surge/zones/:zoneId': { limit: 10, windowSeconds: 60, keyBy: 'user' },

  'ADMIN:*': { limit: 100, windowSeconds: 60, keyBy: 'user' },
  'WEBHOOK:*': { limit: 300, windowSeconds: 60, keyBy: 'ip' },
  'UNAUTHENTICATED:*': { limit: 30, windowSeconds: 60, keyBy: 'ip' },
};

export const DEFAULT_POLICY: RateLimitPolicy = { limit: 10, windowSeconds: 60, keyBy: 'user' };

const ADMIN_PATH_PREFIX = '/api/v1/admin';

const isParam = (segment: string): boolean => segment.startsWith(':');

/**
 * Segment-wise, with `:param` matching exactly one segment.
 *
 * The previous matcher compared the request's literal URL against the pattern
 * and otherwise fell back to `startsWith`, which meant no parameterised policy
 * in the table above ever resolved: a request carries a uuid, never the word
 * ":id". Sub-resources instead inherited whichever collection policy happened
 * to be a string prefix of them — `POST /owner/spaces/{id}/photos` ran on the
 * listing's budget — and the rest silently took the strictest default. A policy
 * that cannot be reached is not a policy (R-API-07).
 */
function matches(pattern: string, routeKey: string): boolean {
  const patternParts = pattern.split('/');
  const routeParts = routeKey.split('/');
  if (patternParts.length !== routeParts.length) return false;

  return patternParts.every((part, i) => isParam(part) || part === routeParts[i]);
}

export function resolvePolicy(method: string, url: string): RateLimitPolicy {
  const pathOnly = url.split('?')[0] ?? url;
  const routeKey = `${method} ${pathOnly}`;

  const patterns = Object.keys(RATE_LIMIT_POLICIES);

  // Literals first, so a collection route is never answered by the policy of
  // the parameterised sibling it shares a shape with.
  const literal = patterns.find((pattern) => pattern === routeKey);
  if (literal !== undefined) return RATE_LIMIT_POLICIES[literal] as RateLimitPolicy;

  const parameterised = patterns.find(
    (pattern) => pattern.includes('/:') && matches(pattern, routeKey),
  );
  if (parameterised !== undefined) return RATE_LIMIT_POLICIES[parameterised] as RateLimitPolicy;

  // Forgetting a policy on a new admin route costs it the generic admin budget,
  // and forgetting one anywhere else costs it the strictest default. Either way
  // the omission fails closed rather than open.
  if (pathOnly.startsWith(ADMIN_PATH_PREFIX)) {
    return RATE_LIMIT_POLICIES['ADMIN:*'] ?? DEFAULT_POLICY;
  }

  return DEFAULT_POLICY;
}
