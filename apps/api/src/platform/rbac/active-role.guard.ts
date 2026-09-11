import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@parkease/contracts/enums';
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from '../auth/current-user.decorator.js';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';

const ROLE_SEGMENTS = new Set<string>([
  Role.DRIVER,
  Role.OWNER,
  Role.VALET,
  Role.WASHER,
  Role.ADMIN,
]);

@Injectable()
export class ActiveRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const user = request.user;
    if (!user) return true;

    const pathOnly = request.url.split('?')[0] ?? request.url;
    const segment = pathOnly.split('/')[3];

    if (!segment || !ROLE_SEGMENTS.has(segment)) return true;

    if (user.activeRole !== segment) {
      throw new ForbiddenException(`Switch to your ${segment} profile to do that.`);
    }
    return true;
  }
}
