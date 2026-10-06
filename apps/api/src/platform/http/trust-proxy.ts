/**
 * Fastify's `trustProxy` for a deployment with `hops` reverse proxies in front of it (SEC-M3).
 *
 * Not the bare number, although that is what the option used to take: in fastify 5.12 a number is
 * fail-closed and trusts nothing, so `request.ip` would be the load balancer for every caller and
 * every IP-keyed rate-limit bucket one shared bucket. And not `true`, which trusts every hop and
 * makes `request.ip` the left-most X-Forwarded-For entry, the one the client writes.
 *
 * `i` is the hop index proxy-addr walks from the socket outwards (0 is the socket peer), so
 * trusting `i < hops` stops exactly `hops` addresses back: the address the outermost trusted proxy
 * saw. The assumption, written down in `.env.example`: the API is reachable ONLY through those
 * proxies. A client that can reach the socket directly is itself hop 0 and can still forge the
 * header; that is a network rule, and no trust setting replaces it.
 */
export function trustProxyHops(hops: number): false | ((address: string, i: number) => boolean) {
  if (hops <= 0) return false;
  return (_address, i) => i < hops;
}
