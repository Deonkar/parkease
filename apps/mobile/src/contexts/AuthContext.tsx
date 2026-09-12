import { type Role } from '@parkease/contracts/enums';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearOnboarded } from '@/features/shared/hooks/useHasOnboarded';
import { api, registerSessionExpiredHandler } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { secureStorage } from '@/lib/secure-storage';
import { uuidv7 } from '@/lib/uuid';

interface AuthMethods {
  signOut: () => Promise<void>;
  switchRole: (role: Role) => Promise<void>;
  setAuthenticated: (roles: readonly Role[], activeRole: Role | null) => void;
}

type AuthContextValue = AuthMethods &
  (
    | { status: 'loading' }
    | { status: 'unauthenticated' }
    | { status: 'authenticated'; roles: readonly Role[]; activeRole: Role | null }
  );

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export type { AuthContextValue };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'unauthenticated' }
    | { status: 'authenticated'; roles: readonly Role[]; activeRole: Role | null }
  >({ status: 'loading' });

  useEffect(() => {
    void (async () => {
      const session = await secureStorage.read();
      if (!session) {
        setState({ status: 'unauthenticated' });
        return;
      }
      setState({
        status: 'authenticated',
        roles: session.roles,
        activeRole: session.activeRole,
      });
    })();
  }, []);

  const signOut = useCallback(async () => {
    await secureStorage.clear();
    await clearOnboarded();
    queryClient.clear();
    setState({ status: 'unauthenticated' });
    router.replace('/');
  }, []);

  const switchRole = useCallback(async (role: Role) => {
    const { data } = await api.post<{
      data: { accessToken: string; refreshToken: string; activeRole: Role };
    }>('/me/roles/active', { role }, { headers: { 'Idempotency-Key': uuidv7() } });
    const session = await secureStorage.read();
    await secureStorage.write({
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      roles: session?.roles ?? [],
      activeRole: data.data.activeRole,
    });
    queryClient.clear();
    setState((prev) =>
      prev.status === 'authenticated' ? { ...prev, activeRole: data.data.activeRole } : prev,
    );
    router.replace(`/(${data.data.activeRole})`);
  }, []);

  const setAuthenticated = useCallback((roles: readonly Role[], activeRole: Role | null) => {
    setState({ status: 'authenticated', roles, activeRole });
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(signOut);
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ ...state, signOut, switchRole, setAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}
