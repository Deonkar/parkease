import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { trustProxyHops } from '../src/platform/http/trust-proxy.js';

/**
 * SEC-M3 (task 18a review). `trustProxy: true` made request.ip the LEFT-most X-Forwarded-For
 * entry, which the client writes. And a bare number is not a hop count in fastify 5.12: it is
 * fail-closed (trusts nothing), so `request.ip` would be the load balancer for every caller and
 * every IP-keyed bucket one shared bucket. These run a real Fastify instance, because what is
 * under test is the address Fastify derives, not the helper's return value.
 */
const ipSeenWith = async (
  trustProxy: ReturnType<typeof trustProxyHops> | boolean,
  forwardedFor: string,
): Promise<string> => {
  const app = Fastify({ trustProxy });
  app.get('/ip', (request) => ({ ip: request.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '10.0.0.1',
    headers: { 'x-forwarded-for': forwardedFor },
  });
  await app.close();
  return (res.json() as { ip: string }).ip;
};

// The client wrote 6.6.6.6 itself; the load balancer appended the address it actually saw.
const SPOOFED_CHAIN = '6.6.6.6, 203.0.113.7';

describe('trustProxyHops', () => {
  it('one hop: the address the load balancer appended, never the one the client wrote', async () => {
    expect(await ipSeenWith(trustProxyHops(1), SPOOFED_CHAIN)).toBe('203.0.113.7');
  });

  it('zero hops: the socket peer, X-Forwarded-For ignored', async () => {
    expect(await ipSeenWith(trustProxyHops(0), SPOOFED_CHAIN)).toBe('10.0.0.1');
  });

  it('two hops walk one entry further back', async () => {
    expect(await ipSeenWith(trustProxyHops(2), SPOOFED_CHAIN)).toBe('6.6.6.6');
  });

  it('the old `true` is the bug: it hands back the spoofed left-most entry', async () => {
    expect(await ipSeenWith(true, SPOOFED_CHAIN)).toBe('6.6.6.6');
  });
});
