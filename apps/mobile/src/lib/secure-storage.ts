import { roleSchema, type Role } from '@parkease/contracts/enums';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

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
      SecureStore.getItemAsync(ACCESS_TOKEN),
      SecureStore.getItemAsync(REFRESH_TOKEN),
      SecureStore.getItemAsync(SESSION_META),
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
      SecureStore.setItemAsync(ACCESS_TOKEN, session.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN, session.refreshToken),
      SecureStore.setItemAsync(
        SESSION_META,
        JSON.stringify({ roles: session.roles, activeRole: session.activeRole }),
      ),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN),
      SecureStore.deleteItemAsync(REFRESH_TOKEN),
      SecureStore.deleteItemAsync(SESSION_META),
    ]);
  },
};
