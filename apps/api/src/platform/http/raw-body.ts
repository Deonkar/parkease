import type { FastifyRequest } from 'fastify';

/** A request that kept the bytes it arrived as. */
export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * Why `rawBody: true` is set on `NestFactory.create` and on the integration
 * harness's `createNestApplication`.
 *
 * Fastify parses `application/json` before any handler runs, so by the time a
 * controller sees `request.body` the exact bytes Razorpay signed are gone.
 * Re-serialising is not equivalent — whitespace, unicode escaping and number
 * formatting all differ, and any one of them breaks the HMAC. This is the bug v1
 * shipped: it verified against `JSON.stringify(req.body)`, which passed in local
 * tests because the test client used the same serialiser, and failed against
 * real Razorpay traffic.
 *
 * An earlier version of this file registered its own `addContentTypeParser`
 * instead, scoped to the webhook path. It collided with the one Nest's Fastify
 * adapter registers during `init()` — "Content type parser 'application/json'
 * already present" — and would have failed to boot. The integration harness
 * caught it because it mirrors production's wiring; nothing else would have.
 *
 * The framework flag keeps `rawBody` on every request rather than only the
 * webhook. That is cheaper than it sounds: Nest assigns the same Buffer Fastify
 * already parsed from, so it extends that buffer's lifetime to the request's
 * rather than allocating a second copy. The 1 MiB `bodyLimit` on the adapter is
 * what actually bounds it.
 *
 * This file exists for this comment and the type above. There is deliberately no
 * function to call.
 */
export const RAW_BODY_ENABLED = true;
