import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import { reportError } from './report';

/**
 * The access token lives in memory only (ADR-034): not localStorage, not sessionStorage, which any
 * injected script can read. The refresh token is the httpOnly `pe_admin_rt` cookie the API sets on
 * `/api/v1/auth/admin`, which JavaScript cannot read at all.
 */
export interface AdminUser {
  readonly id: string;
  readonly roles: readonly string[];
}

export type SessionStatus = 'loading' | 'signed_in' | 'signed_out';

interface SessionState {
  readonly status: SessionStatus;
  readonly user: AdminUser | null;
}

const sessionBodySchema = z.object({
  data: z.object({
    accessToken: z.string().min(1),
    expiresIn: z.number().int().positive(),
    user: z.object({ id: z.string().uuid(), roles: z.array(z.string()) }),
  }),
});

let accessToken: string | null = null;
let state: SessionState = { status: 'loading', user: null };
const listeners = new Set<() => void>();

function set(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const AUTH_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1/auth/admin`;

export const currentToken = (): string | null => accessToken;

export function signedOut(): void {
  accessToken = null;
  set({ status: 'signed_out', user: null });
}

/** Applies a `/auth/admin/session|refresh` response. A body that does not parse is a sign-out. */
async function accept(response: Response): Promise<boolean> {
  if (!response.ok) {
    signedOut();
    return false;
  }
  const parsed = sessionBodySchema.safeParse(await response.json());
  if (!parsed.success) {
    reportError('session response did not match the contract', parsed.error.issues);
    signedOut();
    return false;
  }
  accessToken = parsed.data.data.accessToken;
  set({ status: 'signed_in', user: parsed.data.data.user });
  return true;
}

// Fastify answers 400 to an empty JSON body, so refresh and logout send `{}` (S-143).
const cookiePost = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(`${AUTH_BASE}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

let refreshing: Promise<boolean> | null = null;

/**
 * Single-flight refresh (rule 9): every 401 in flight waits on one promise. Rotation means a
 * second concurrent refresh would present an already-rotated cookie and trip reuse detection,
 * which revokes the whole family and signs the admin out everywhere.
 */
export function refreshOnce(): Promise<boolean> {
  refreshing ??= cookiePost('refresh')
    .then(accept)
    .catch((err: unknown) => {
      reportError('refresh failed', err);
      signedOut();
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function exchangeIdToken(idToken: string): Promise<boolean> {
  return accept(await cookiePost('session', { idToken }));
}

export async function logout(): Promise<void> {
  try {
    await cookiePost('logout');
  } finally {
    signedOut();
  }
}

/** A dev fixtures session: no Firebase, no API. Only reachable with VITE_ADMIN_FIXTURES=1. */
export function fixtureSignIn(): void {
  accessToken = 'fixtures';
  set({
    status: 'signed_in',
    user: { id: '0192f000-0000-7000-8000-000000000001', roles: ['admin'] },
  });
}

export function useSession(): SessionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
