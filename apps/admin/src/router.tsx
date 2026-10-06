import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { RequireAdmin } from './components/Shell';
import { AuditPage } from './features/audit/AuditPage';
import { LoginPage, NotAuthorisedPage } from './features/auth/LoginPage';
import { BookingsPage } from './features/bookings/BookingsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { FinancePage } from './features/finance/FinancePage';
import { ModerationPage } from './features/moderation/ModerationPage';
import { PartnersPage } from './features/partners/PartnersPage';
import { SpacesPage } from './features/spaces/SpacesPage';
import { SurgePage } from './features/surge/SurgePage';
import { UsersPage } from './features/users/UsersPage';

const root = createRootRoute({ component: Outlet });
const login = createRoute({ getParentRoute: () => root, path: '/login', component: LoginPage });
const notAuthorised = createRoute({
  getParentRoute: () => root,
  path: '/not-authorised',
  component: NotAuthorisedPage,
});

/** Every feature page sits under the admin gate, so none mounts without a session. */
const admin = createRoute({ getParentRoute: () => root, id: 'admin', component: RequireAdmin });
const page = <P extends string>(path: P, component: () => React.ReactNode) =>
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
    page('/', DashboardPage),
    page('/spaces', SpacesPage),
    page('/partners', PartnersPage),
    page('/users', UsersPage),
    page('/bookings', BookingsPage),
    finance,
    page('/surge', SurgePage),
    page('/moderation', ModerationPage),
    page('/audit', AuditPage),
  ]),
]);

export const router = createRouter({ routeTree: tree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
