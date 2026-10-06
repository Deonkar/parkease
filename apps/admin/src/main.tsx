import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntApp, ConfigProvider } from 'antd';
import enGB from 'antd/locale/en_GB';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiError, FIXTURES } from './lib/api';
import { fixtureSignIn, refreshOnce } from './lib/session';
import { router } from './router';
import { theme } from './theme';

/** A role revoked mid-session lands on /not-authorised at the next request, not on a reload. */
const onError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 403)
    void router.navigate({ to: '/not-authorised' });
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

// The refresh cookie restores a session across reloads; without one the gate sends us to /login.
if (FIXTURES) fixtureSignIn();
else void refreshOnce();

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <ConfigProvider theme={theme} locale={enGB}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
