import { Stack } from 'expo-router';

/**
 * Profile and registration, as a stack so `register` pushes over the profile
 * with a working back gesture. `index` is always beneath it — even on a deep
 * link straight to `register` — so finishing registration dismisses TO the
 * profile rather than stacking a second copy of it.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function WasherProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
