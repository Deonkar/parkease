import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { z } from 'zod';

import { RequireAdmin } from './components/Shell';
import { FinancePage } from './features/finance/FinancePage';

const root = createRootRoute({ component: Outlet });
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  component: lazyRouteComponent(() => import('./features/auth/LoginPage'), 'LoginPage'),
});
const notAuthorised = createRoute({
  getParentRoute: () => root,
  path: '/not-authorised',
  component: lazyRouteComponent(() => import('./features/auth/LoginPage'), 'NotAuthorisedPage'),
});

/** Every feature page sits under the admin gate, so none mounts without a session. */
const admin = createRoute({ getParentRoute: () => root, id: 'admin', component: RequireAdmin });
/** Each page is its own chunk: antd tables, MapLibre and the finance screens load on first visit. */
const page = <P extends string>(path: P, component: ReturnType<typeof lazyRouteComponent>) =>
  createRoute({ getParentRoute: () => admin, path, component });

const financeSearch = z.object({ txnId: z.string().uuid().optional() });
const finance = createRoute({
  getParentRoute: () => admin,
  path: '/finance',
  validateSearch: (search) => financeSearch.parse(search),
  component: function Finance() {
    return <FinancePage txnId={finance.useSearch().txnId} />;
  },
});

const tree = root.addChildren([
  login,
  notAuthorised,
  admin.addChildren([
    page(
      '/',
      lazyRouteComponent(() => import('./features/dashboard/DashboardPage'), 'DashboardPage'),
    ),
    page(
      '/spaces',
      lazyRouteComponent(() => import('./features/spaces/SpacesPage'), 'SpacesPage'),
    ),
    page(
      '/partners',
      lazyRouteComponent(() => import('./features/partners/PartnersPage'), 'PartnersPage'),
    ),
    page(
      '/users',
      lazyRouteComponent(() => import('./features/users/UsersPage'), 'UsersPage'),
    ),
    page(
      '/bookings',
      lazyRouteComponent(() => import('./features/bookings/BookingsPage'), 'BookingsPage'),
    ),
    finance,
    page(
      '/surge',
      lazyRouteComponent(() => import('./features/surge/SurgePage'), 'SurgePage'),
    ),
    page(
      '/moderation',
      lazyRouteComponent(() => import('./features/moderation/ModerationPage'), 'ModerationPage'),
    ),
    page(
      '/audit',
      lazyRouteComponent(() => import('./features/audit/AuditPage'), 'AuditPage'),
    ),
  ]),
]);

export const router = createRouter({ routeTree: tree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
