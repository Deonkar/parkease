import { secureStorage } from './secure-storage';

export async function isDevMockSession(): Promise<boolean> {
  if (!__DEV__) return false;
  const session = await secureStorage.read();
  if (!session) return false;
  return (
    session.accessToken.startsWith('dev-mock-access-') ||
    session.accessToken.startsWith('dev-token-')
  );
}
