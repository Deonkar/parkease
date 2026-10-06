import { createHash } from 'node:crypto';

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { createSessionSchema, sessionResponseSchema } from '@parkease/contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CreateSessionCommand } from '../../domains/identity/commands/create-session.command.js';
import { Public } from '../../platform/auth/public.decorator.js';
import { TokenService } from '../../platform/auth/token.service.js';
import { env } from '../../platform/config/env.schema.js';
import { parseOutgoing } from '../../platform/http/index.js';

import { clearAdminCookie, readAdminCookie, serializeAdminCookie } from './admin-cookie.js';

// The refresh token never appears in these bodies — it travels only in the cookie.
const adminSessionBodySchema = sessionResponseSchema.omit({ refreshToken: true });
const adminRefreshBodySchema = sessionResponseSchema.pick({ accessToken: true, expiresIn: true });

/**
 * `Secure` follows the deployment, not the request. The Host header is
 * client-controlled, so keying on it would let a caller choose whether the
 * cookie is marked Secure.
 */
const secureCookies = (): boolean => env.NODE_ENV === 'production';

/**
 * The admin panel's session. Same Firebase sign-in as `/auth/session`, but the
 * session is refused unless the user holds an active admin role, and the
 * refresh token is delivered as an httpOnly cookie rather than a JSON field.
 *
 * `passthrough` keeps Nest in charge of the response, so the
 * TransformInterceptor still wraps the body in `{ data }`.
 */
@Controller('auth/admin')
@Public()
export class AdminAuthController {
  constructor(
    private readonly createSession: CreateSessionCommand,
    private readonly tokenService: TokenService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async session(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = createSessionSchema.parse(body);

    const result = await this.createSession.execute({
      idToken: parsed.idToken,
      userAgent: request.headers['user-agent'],
      requireRole: Role.ADMIN,
    });

    reply.header(
      'set-cookie',
      serializeAdminCookie(result.refreshToken, { secure: secureCookies() }),
    );
    return parseOutgoing(adminSessionBodySchema, result, 'admin session');
  }

  /**
   * A replay of this request (same Idempotency-Key and cookie) is answered from
   * the idempotency store: the cached body, and NO Set-Cookie. A client that lost
   * the first response must treat it as a re-login, not retry with the old key.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = readAdminCookie(request.headers.cookie);
    if (token === null) {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }

    const tokens = await this.tokenService.rotate(token, request.headers['user-agent'], {
      requireRole: Role.ADMIN,
    });

    reply.header(
      'set-cookie',
      serializeAdminCookie(tokens.refreshToken, { secure: secureCookies() }),
    );
    return parseOutgoing(adminRefreshBodySchema, tokens, 'admin refresh');
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readAdminCookie(request.headers.cookie);
    if (token !== null) {
      await this.tokenService.revoke(createHash('sha256').update(token).digest('hex'));
    }
    // Always clear: a logout with a missing or mangled cookie is still a logout.
    reply.header('set-cookie', clearAdminCookie({ secure: secureCookies() }));
  }
}
