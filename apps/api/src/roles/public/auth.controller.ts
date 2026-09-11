import { createHash } from 'node:crypto';

import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  createSessionSchema,
  refreshSessionSchema,
  logoutSchema,
} from '@parkease/contracts/public';
import type { FastifyRequest } from 'fastify';

import {
  CreateSessionCommand,
  type CreateSessionResult,
} from '../../domains/identity/commands/create-session.command.js';
import { Public } from '../../platform/auth/public.decorator.js';
import { TokenService } from '../../platform/auth/token.service.js';

@Controller('auth')
@Public()
export class AuthController {
  constructor(
    private readonly createSession: CreateSessionCommand,
    private readonly tokenService: TokenService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async session(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CreateSessionResult> {
    const parsed = createSessionSchema.parse(body);

    return this.createSession.execute({
      idToken: parsed.idToken,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown) {
    const parsed = refreshSessionSchema.parse(body);
    return this.tokenService.rotate(parsed.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    const parsed = logoutSchema.parse(body);
    const tokenHash = createHash('sha256').update(parsed.refreshToken).digest('hex');
    await this.tokenService.revoke(tokenHash);
  }
}
