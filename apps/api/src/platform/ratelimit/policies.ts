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
  'POST /api/v1/driver/bookings': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/payments': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/driver/payments/verify': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/valet/jobs/:id/accept': { limit: 30, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/uploads': { limit: 20, windowSeconds: 60, keyBy: 'user' },
  'POST /api/v1/me/roles/active': { limit: 10, windowSeconds: 60, keyBy: 'user' },
  'ADMIN:*': { limit: 100, windowSeconds: 60, keyBy: 'user' },
  'WEBHOOK:*': { limit: 300, windowSeconds: 60, keyBy: 'ip' },
  'UNAUTHENTICATED:*': { limit: 30, windowSeconds: 60, keyBy: 'ip' },
};

export const DEFAULT_POLICY: RateLimitPolicy = { limit: 10, windowSeconds: 60, keyBy: 'user' };
