import { warn } from '@/lib/log';

/**
 * Whether the shared screens are served fixtures instead of the network, so they open in the web
 * preview with no API (the owner and washer dev-mock pattern, ruling T11-W1). Extracted on its
 * second use in `features/shared` — get-paid and reviews (R-ARCH-07).
 *
 * `__DEV__` is read through `typeof` (vitest has no Metro global), `lib/dev-mock` is imported only
 * past that check (it chains into react-native), and it never rejects: a session that cannot be
 * read goes to the network, logged (R-FAIL-01). Always false in a release build.
 */
export async function isSharedDevMock(where: string): Promise<boolean> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  try {
    const { isDevMockSession } = await import('@/lib/dev-mock');
    return await isDevMockSession();
  } catch (error) {
    warn(`${where}: could not read the session; serving the network`, error);
    return false;
  }
}
