import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE']);

/**
 * Every write in this API takes JSON. A form-encoded or text/plain body is what a cross-site
 * `<form>` can send without a preflight, so refusing it closes that door whatever the route's auth
 * (S-139). Runs first, before authentication, so the refusal costs nothing.
 */
@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (BODYLESS.has(request.method)) return true;
    const type = request.headers['content-type'];
    if (type === undefined || type.toLowerCase().startsWith('application/json')) return true;
    throw new HttpException(
      { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send the request body as application/json.' },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}
