import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { env } from '../../platform/config/env.schema.js';

/**
 * SEC-M2 (task 18a review). The admin refresh token lives in a cookie, and global CORS lets
 * credentialed requests in from every configured origin, the marketing site included.
 * SameSite=Strict does not help either: parkease.in, admin.parkease.in and api.parkease.in are
 * one site. So an XSS on the web origin could POST /auth/admin/refresh with credentials and read
 * an admin access token out of the response.
 *
 * When `ADMIN_ORIGIN` is set (required in production), only a request whose Origin header is
 * exactly that origin reaches these routes. A browser always sends Origin on a cross-origin or
 * same-origin POST, so a missing one is not the panel and is refused as well. Unset outside
 * production means no check: local tools and tests that send no Origin keep working.
 *
 * Read per request rather than captured at construction, so the setting is the one in force.
 * Global CORS is deliberately left alone: this narrows one cookie's routes, not the API.
 */
@Injectable()
export class AdminOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const allowed = env.ADMIN_ORIGIN;
    if (allowed === undefined) return true;

    const origin = context.switchToHttp().getRequest<FastifyRequest>().headers.origin;
    if (origin === allowed) return true;

    throw new ForbiddenException({
      error: 'ORIGIN_NOT_ALLOWED',
      message: 'Sign in from the admin panel.',
    });
  }
}
