import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { secureStorage } from './secure-storage';
import { uuidv7 } from './uuid';

export interface Intent {
  readonly idempotencyKey: string;
}

export const newIntent = (): Intent => ({ idempotencyKey: uuidv7() });

interface CustomMeta {
  _retriedAfterRefresh?: boolean;
  _skipAuth?: boolean;
}

type RequestMeta = InternalAxiosRequestConfig & CustomMeta;

class SessionExpiredError extends Error {
  constructor() {
    super('Session expired — no refresh token available');
    this.name = 'SessionExpiredError';
  }
}

export const api = axios.create({
  baseURL: `${process.env.EXPO_PUBLIC_API_URL ?? ''}/api/v1`,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: RequestMeta) => {
  if (!config._skipAuth) {
    const session = await secureStorage.read();
    if (session) config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const method = (config.method ?? 'get').toLowerCase();
  if (method !== 'get' && method !== 'head') {
    if (!config.headers['Idempotency-Key']) {
      throw new Error(
        `${method.toUpperCase()} ${config.url ?? ''} has no Idempotency-Key. ` +
          'Pass an Intent from the component that started the action.',
      );
    }
  }

  return config;
});

let refreshInFlight: Promise<string> | null = null;

async function refreshSession(): Promise<string> {
  refreshInFlight ??= (async () => {
    try {
      const session = await secureStorage.read();
      if (!session) throw new SessionExpiredError();

      const { data } = await api.post<{ data: { accessToken: string; refreshToken: string } }>(
        '/auth/refresh',
        { refreshToken: session.refreshToken },
        {
          _skipAuth: true,
          headers: { 'Idempotency-Key': uuidv7() },
        } as AxiosRequestConfig & CustomMeta,
      );

      await secureStorage.write({
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
        roles: session.roles,
        activeRole: session.activeRole,
      });

      return data.data.accessToken;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RequestMeta | undefined;

    if (error.response?.status !== 401 || !config || config._skipAuth) throw error;
    if (config._retriedAfterRefresh) throw error;

    config._retriedAfterRefresh = true;

    try {
      const accessToken = await refreshSession();
      config.headers.Authorization = `Bearer ${accessToken}`;
      return await api(config);
    } catch {
      await onSessionExpired();
      throw error;
    }
  },
);

let onSessionExpired: () => Promise<void> = async () => {};
export const registerSessionExpiredHandler = (handler: () => Promise<void>): void => {
  onSessionExpired = handler;
};
