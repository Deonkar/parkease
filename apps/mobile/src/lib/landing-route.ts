import { type Role } from '@parkease/contracts/enums';
import { type Href } from 'expo-router';

/**
 * Where a signed-in session lands (T11-W1). A bare group href such as
 * `/(washer)` resolves only through the group's `index.tsx`, and the partner
 * groups have none — their first screen is Offers — so a bare role-group href sent every
 * valet and washer to "Unmatched Route". Every landing goes through this one
 * table; `landing-route.test.ts` asserts each target is a real route file.
 *
 * Admin has no mobile surface (the admin panel is web, and switch-role filters
 * it out), so an admin session lands on choose-role instead of `/(admin)`,
 * which never resolved.
 */
const LANDING = {
  driver: '/(driver)',
  owner: '/(owner)',
  valet: '/(valet)/offers',
  washer: '/(washer)/offers',
  admin: '/(auth)/choose-role',
} as const satisfies Record<Role, Href>;

const NO_ACTIVE_ROLE = '/(auth)/choose-role' satisfies Href;

export function landingRouteFor(role: Role | null): Href {
  return role === null ? NO_ACTIVE_ROLE : LANDING[role];
}

/** Where an account that holds only `admin` lands: a screen that sends it to the web (S-54). */
export const ADMIN_ONLY_ROUTE = '/(auth)/admin-only' satisfies Href;

/**
 * An account whose every role is `admin` has nothing to do in this app: every
 * choice on choose-role is a role it does not hold, and `POST /me/roles/active`
 * answers 403 to each (S-54). An account with no roles yet is a new user, not
 * an admin, so it still chooses.
 */
export function isAdminOnly(roles: readonly Role[]): boolean {
  return roles.length > 0 && roles.every((role) => role === 'admin');
}

/** The landing for a whole session: the admin-only screen first, then the active role's. */
export function landingRouteForSession(roles: readonly Role[], activeRole: Role | null): Href {
  return isAdminOnly(roles) ? ADMIN_ONLY_ROUTE : landingRouteFor(activeRole);
}
