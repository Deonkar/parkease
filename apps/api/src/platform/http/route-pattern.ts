import type { FastifyRequest } from 'fastify';

type RoutedRequest = Pick<FastifyRequest, 'url'> & {
  readonly routeOptions?: { readonly url?: string | undefined } | undefined;
};

/**
 * The route the router matched, `/api/v1/admin/partners/:id`, never the URL the client spelled.
 *
 * Fastify's router decodes a path before matching it, so `/api/v1/%61dmin/users` reaches the
 * `/api/v1/admin/users` handler. Anything that decides on the raw `request.url` instead reads a
 * spelling the client chose: the rate limiter gave every encoding variant its own bucket and looked
 * policies up under a name no policy has, and the active-role guard saw no role segment at all
 * (SEC-H1, pentest F1, task 18a review). The matched pattern is one string per route, whatever the
 * spelling and whatever the ids in it.
 *
 * Inside the Nest pipeline the router has always matched by the time a guard or interceptor runs,
 * so `routeOptions.url` is set. The raw path (query stripped) is only the fallback for a request
 * that never went through the router, a 404 or a hand-built test request.
 */
export function routePattern(request: RoutedRequest): string {
  const matched = request.routeOptions?.url;
  if (typeof matched === 'string') return matched;
  return request.url.split('?')[0] ?? request.url;
}
