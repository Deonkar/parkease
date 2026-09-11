import { AsyncLocalStorage } from 'node:async_hooks';

import { uuidv7 } from '@parkease/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface CorrelationContext {
  readonly correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function correlationIdMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const header = request.headers['x-correlation-id'];
  const correlationId = typeof header === 'string' && header.length > 0 ? header : uuidv7();

  void reply.header('x-correlation-id', correlationId);

  correlationStore.run({ correlationId }, done);
}
