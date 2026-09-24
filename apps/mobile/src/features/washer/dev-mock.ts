import { warn } from '@/lib/log';

/**
 * Whether the washer screens are served `api/dev-fixtures.ts` instead of the
 * network (ruling T11-W1). `isDevMockSession()` is the rule; this is the one
 * door every washer fixture path goes through.
 *
 * Three things differ from calling `isDevMockSession()` directly:
 *
 * - `__DEV__` is read through `typeof`. It is a Metro global, and a vitest run
 *   has none, so a bare read would throw a ReferenceError there.
 * - `lib/dev-mock` is imported only past that check. It chains into
 *   `secure-storage` → `react-native`, which a node test cannot load
 *   (learnings.md, "A closure-local dynamic import…").
 * - It never rejects. A session that cannot be read is not a dev-mock session:
 *   the call goes to the network as it would have, and the failure is logged
 *   at warn rather than surfacing as an unhandled rejection in a capture or a
 *   presence toggle (R-FAIL-01).
 *
 * In a release build `__DEV__` is false, so nothing past the first line runs
 * and no fixture is ever served.
 */
export async function isWasherDevMock(): Promise<boolean> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  try {
    const { isDevMockSession } = await import('@/lib/dev-mock');
    return await isDevMockSession();
  } catch (error) {
    warn('washer.isWasherDevMock: could not read the session; serving the network', error);
    return false;
  }
}
