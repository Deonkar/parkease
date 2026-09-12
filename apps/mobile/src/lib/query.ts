import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (typeof error === 'object' && 'response' in error) {
          const status = (error as { response?: { status?: number } }).response?.status;
          if (status !== undefined && status >= 400 && status < 500) return false;
        }
        return true;
      },
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
