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
  'ADMIN:*': { limit: 100, windowSeconds: 60, keyBy: 'user' },
  'WEBHOOK:*': { limit: 300, windowSeconds: 60, keyBy: 'ip' },
  'UNAUTHENTICATED:*': { limit: 30, windowSeconds: 60, keyBy: 'ip' },
};

export const DEFAULT_POLICY: RateLimitPolicy = { limit: 10, windowSeconds: 60, keyBy: 'user' };
