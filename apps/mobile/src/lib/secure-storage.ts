import { roleSchema, type Role } from '@parkease/contracts/enums';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

const isWeb = Platform.OS === 'web';

const store = {
  async getItem(key: string): Promise<string | null> {
    if (isWeb) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (isWeb) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (isWeb) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

const ACCESS_TOKEN = 'parkease.accessToken';
const REFRESH_TOKEN = 'parkease.refreshToken';
const SESSION_META = 'parkease.sessionMeta';

const sessionMetaSchema = z.object({
  roles: z.array(roleSchema),
  activeRole: roleSchema.nullable(),
});

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly roles: readonly Role[];
  readonly activeRole: Role | null;
}

export const secureStorage = {
  async read(): Promise<StoredSession | null> {
    const [accessToken, refreshToken, meta] = await Promise.all([
      store.getItem(ACCESS_TOKEN),
      store.getItem(REFRESH_TOKEN),
      store.getItem(SESSION_META),
    ]);
    if (!accessToken || !refreshToken || !meta) return null;

    let parsed: z.infer<typeof sessionMetaSchema>;
    try {
      const result = sessionMetaSchema.safeParse(JSON.parse(meta));
      if (!result.success) return null;
      parsed = result.data;
    } catch {
      return null;
    }

    return { accessToken, refreshToken, ...parsed };
  },

  async write(session: StoredSession): Promise<void> {
    await Promise.all([
      store.setItem(ACCESS_TOKEN, session.accessToken),
      store.setItem(REFRESH_TOKEN, session.refreshToken),
      store.setItem(
        SESSION_META,
        JSON.stringify({ roles: session.roles, activeRole: session.activeRole }),
      ),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      store.deleteItem(ACCESS_TOKEN),
      store.deleteItem(REFRESH_TOKEN),
      store.deleteItem(SESSION_META),
    ]);
  },
};
