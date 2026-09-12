import { SplashScreen } from '@parkease/ui-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useHasOnboarded } from '@/features/shared/hooks/useHasOnboarded';

export default function Splash() {
  const auth = useAuth();
  const hasOnboarded = useHasOnboarded();

  if (auth.status === 'loading' || hasOnboarded === undefined) {
    return <SplashScreen />;
  }

  if (auth.status === 'unauthenticated') {
    return <Redirect href={hasOnboarded ? '/(auth)/phone' : '/(auth)/onboarding'} />;
  }

  if (auth.activeRole === null) {
    return <Redirect href="/(auth)/choose-role" />;
  }

  return <Redirect href={`/(${auth.activeRole})`} />;
}
