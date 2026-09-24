import { SplashScreen } from '@parkease/ui-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useHasOnboarded } from '@/features/shared/hooks/useHasOnboarded';
import { landingRouteFor } from '@/lib/landing-route';

export default function Splash() {
  const auth = useAuth();
  const hasOnboarded = useHasOnboarded();

  if (auth.status === 'loading' || hasOnboarded === undefined) {
    return <SplashScreen />;
  }

  if (auth.status === 'unauthenticated') {
    return <Redirect href={hasOnboarded ? '/(auth)/phone' : '/(auth)/onboarding'} />;
  }

  return <Redirect href={landingRouteFor(auth.activeRole)} />;
}
