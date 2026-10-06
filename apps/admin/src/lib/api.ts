import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { z as zod } from 'zod';

import { fixtureFor } from './fixtures';
import { currentToken, refreshOnce, signedOut } from './session';

const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;
export const FIXTURES = import.meta.env.VITE_ADMIN_FIXTURES === '1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
  }
}

const errorEnvelope = zod.object({
  error: zod.object({
    code: zod.string(),
    message: zod.string(),
    traceId: zod.string().optional(),
  }),
});
const dataEnvelope = zod.object({
  data: zod.unknown(),
  meta: zod.record(zod.unknown()).optional(),
});

export interface ApiResult<T> {
  readonly data: T;
  readonly meta?: Record<string, unknown> | undefined;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Minted once per user intent and reused by every retry of it (mobile.md). */
  readonly idempotencyKey?: string;
}

/** Drops empty values so `?q=&role=` never reaches the API as an empty filter. */
export function withQuery(
  path: string,
  query: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

export async function request<S extends z.ZodTypeAny>(
  schema: S,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<z.output<S>>> {
  const method = options.method ?? 'GET';
  if (FIXTURES) {
    const fixture = fixtureFor(method, path);
    return { data: schema.parse(fixture.data) as z.output<S>, meta: fixture.meta };
  }

  const send = (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(currentToken() === null ? {} : { authorization: `Bearer ${currentToken() ?? ''}` }),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

  let response = await send();
  if (response.status === 401 && (await refreshOnce())) response = await send();
  if (response.status === 401) signedOut();

  const json: unknown = await response.json().catch((err: unknown) => {
    // A non-JSON body (a proxy's HTML error page) is reported, never treated as data.
    throw new ApiError(response.status, 'BAD_RESPONSE', `Unreadable response (${String(err)})`);
  });

  if (!response.ok) {
    const parsed = errorEnvelope.safeParse(json);
    throw parsed.success
      ? new ApiError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.traceId,
        )
      : new ApiError(response.status, 'UNKNOWN', `Request failed with ${String(response.status)}`);
  }

  const envelope = dataEnvelope.parse(json);
  return { data: schema.parse(envelope.data) as z.output<S>, meta: envelope.meta };
}

export function useApi<S extends z.ZodTypeAny>(schema: S, path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => request(schema, path), enabled });
}

/**
 * A mutation whose idempotency key is minted when the user starts the action (`mutate` is called
 * with a fresh key per click) and survives TanStack's retries. Invalidates every query on success,
 * which is cheap for an admin tool and never shows a stale queue.
 */
export function useAction<S extends z.ZodTypeAny, V>(
  schema: S,
  build: (vars: V) => { path: string; method?: RequestOptions['method']; body?: unknown },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ vars, key }: { vars: V; key: string }) => {
      const { path, method = 'POST', body } = build(vars);
      return request(schema, path, { method, body, idempotencyKey: key });
    },
    onSuccess: () => client.invalidateQueries(),
  });
}

export const intentKey = (): string => crypto.randomUUID();
