import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  readonly id: string;
  readonly roles: readonly string[];
  readonly activeRole: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user: AuthUser }>();
    return request.user;
  },
);
