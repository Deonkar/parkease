import { type Role } from '@parkease/contracts/enums';
import {
  type RoleSession,
  roleSessionSchema,
  type SelfServeRole,
} from '@parkease/contracts/shared';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';

import { clearOnboarded } from '@/features/shared/hooks/useHasOnboarded';
import { deactivateRegisteredPushToken } from '@/features/shared/notifications/push';
import { releaseBackgroundTracking } from '@/features/valet/location/release';
import { api, registerSessionExpiredHandler } from '@/lib/api';
import { landingRouteFor } from '@/lib/landing-route';
import { queryClient } from '@/lib/query';
import { secureStorage } from '@/lib/secure-storage';
import { clearSessionScopedStorage } from '@/lib/session-storage';
import { disconnectAll } from '@/lib/socket';
import { uuidv7 } from '@/lib/uuid';

/** A role change answers the new session, its roles and the active one (S-149). */
const roleSessionEnvelope = z.object({ data: roleSessionSchema });

interface AuthMethods {
  signOut: () => Promise<void>;
  switchRole: (role: Role) => Promise<void>;
  addRole: (role: SelfServeRole['role']) => Promise<void>;
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
    // BEFORE the tokens go: releasing the sensor needs an authenticated PATCH
    // to tell the server this valet is offline. Clearing first would leave the
    // foreground service running, the task still firing, and the server still
    // dispatching jobs to a signed-out phone.
    await releaseBackgroundTracking();
    // Also before the tokens go: retiring the push token is an authenticated DELETE. Best effort.
    await deactivateRegisteredPushToken();

    await secureStorage.clear();
    // Tokens are only half of it: a signed-in session also leaves unencrypted
    // AsyncStorage behind — the valet's location queue among it — and a GPS
    // trail that outlives logout is readable by whoever holds the device next.
    await clearSessionScopedStorage();
    disconnectAll();
    await clearOnboarded();
    queryClient.clear();
    setState({ status: 'unauthenticated' });
    router.replace('/');
  }, []);

  /** Stores a role session and lands in its role: shared by a switch and a new role. */
  const enterSession = useCallback(async (session: RoleSession) => {
    await secureStorage.write({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      roles: session.roles,
      activeRole: session.activeRole,
    });
    queryClient.clear();
    setState({ status: 'authenticated', roles: session.roles, activeRole: session.activeRole });
    router.replace(landingRouteFor(session.activeRole));
  }, []);

  /** Takes on owner, valet or washer and switches into it (S-149). */
  const addRole = useCallback(
    async (role: SelfServeRole['role']) => {
      if (__DEV__ && !(await secureStorage.read())) {
        // The dev-mock preview has no server to grant with; it switches straight in.
        await secureStorage.write({
          accessToken: `dev-mock-access-${String(Date.now())}`,
          refreshToken: `dev-mock-refresh-${String(Date.now())}`,
          roles: [role],
          activeRole: role,
        });
        queryClient.clear();
        setState({ status: 'authenticated', roles: [role], activeRole: role });
        router.replace(landingRouteFor(role));
        return;
      }
      const response = await api.post<unknown>(
        '/me/roles',
        { role },
        { headers: { 'Idempotency-Key': uuidv7() } },
      );
      await enterSession(roleSessionEnvelope.parse(response.data).data);
    },
    [enterSession],
  );

  const switchRole = useCallback(
    async (role: Role) => {
      const session = await secureStorage.read();

      if (__DEV__ && !session) {
        await secureStorage.write({
          accessToken: `dev-mock-access-${String(Date.now())}`,
          refreshToken: `dev-mock-refresh-${String(Date.now())}`,
          roles: [role],
          activeRole: role,
        });
        queryClient.clear();
        setState({ status: 'authenticated', roles: [role], activeRole: role });
        router.replace(landingRouteFor(role));
        return;
      }

      const response = await api.post<unknown>(
        '/me/roles/active',
        { role },
        { headers: { 'Idempotency-Key': uuidv7() } },
      );
      await enterSession(roleSessionEnvelope.parse(response.data).data);
    },
    [enterSession],
  );

  const setAuthenticated = useCallback((roles: readonly Role[], activeRole: Role | null) => {
    setState({ status: 'authenticated', roles, activeRole });
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(signOut);
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ ...state, signOut, switchRole, addRole, setAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}
