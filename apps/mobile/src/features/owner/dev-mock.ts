import { warn } from '@/lib/log';

/**
 * Whether the owner screens are served `api/dev-fixtures.ts` instead of the
 * network, so the dashboard, earnings and bookings screens can be opened in
 * the web preview with no API and no database (task 7b, extending the
 * washer's ruling T11-W1 — `features/washer/dev-mock.ts` is the pattern this
 * mirrors). `isOwnerDevMock()` is the one door every owner fixture path goes
 * through.
 *
 * Copied, not imported: importing `features/washer/dev-mock` would be a
 * cross-role import the lint layer rule forbids (features/{role} may import
 * features/shared only).
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
 *   at warn rather than surfacing as an unhandled rejection (R-FAIL-01).
 *
 * In a release build `__DEV__` is false, so nothing past the first line runs
 * and no fixture is ever served.
 */
export async function isOwnerDevMock(): Promise<boolean> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  try {
    const { isDevMockSession } = await import('@/lib/dev-mock');
    return await isDevMockSession();
  } catch (error) {
    warn('owner.isOwnerDevMock: could not read the session; serving the network', error);
    return false;
  }
}
