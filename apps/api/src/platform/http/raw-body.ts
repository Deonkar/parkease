import { RAZORPAY_WEBHOOK_PATH } from '@parkease/contracts/public';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** A request that kept the bytes it arrived as. Only the webhook route gets one. */
export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * 1 MiB. Razorpay's largest event is nowhere near it; the limit exists so a
 * `@Public()` endpoint cannot be used to make us buffer an arbitrary body.
 */
export const WEBHOOK_BODY_LIMIT_BYTES = 1 * 1024 * 1024;

/**
 * Keeps the raw request bytes for the webhook route, and only for it.
 *
 * Fastify parses `application/json` before any handler runs, so by the time a
 * controller sees `request.body` the exact bytes Razorpay signed are gone.
 * Re-serialising is not equivalent — key order, whitespace and unicode escaping
 * all differ, and any one of them breaks the HMAC. This is the bug v1 shipped:
 * it verified against `JSON.stringify(req.body)`, which passed in local tests
 * because the test client used the same serialiser, and failed against real
 * Razorpay traffic.
 *
 * **Registered by `main.ts` and by the integration HTTP harness, from here.**
 * That is the point of this file being a function rather than a block inside
 * `main.ts`: a signature test running against a harness that parses bodies
 * differently from production proves nothing about production.
 *
 * Every other route gets the parsed object only, so we are not holding a second
 * copy of every payload in memory.
 */
export function registerRawBodyParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
    (request, body, done) => {
      const raw = body as Buffer;

      if (request.url.startsWith(RAZORPAY_WEBHOOK_PATH)) {
        (request as RawBodyRequest).rawBody = raw;
      }

      // An empty body is a legitimate POST, not a parse failure. `undefined`
      // rather than `{}` so a schema that requires fields still rejects it.
      if (raw.length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(raw.toString('utf8')) as unknown);
      } catch (error) {
        // Handed to Fastify, which answers 400. Not swallowed, and not turned
        // into an empty object that would fail much later and much less
        // legibly (R-FAIL-01).
        done(error as Error, undefined);
      }
    },
  );
}
