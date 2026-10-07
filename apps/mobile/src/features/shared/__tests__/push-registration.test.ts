import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerPushToken = vi.fn();
const deactivatePushToken = vi.fn();
const getExpoPushTokenAsync = vi.fn();
const warn = vi.fn();
let isDevice = true;
let projectId: string | undefined = 'proj-1';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-device', () => ({
  get isDevice() {
    return isDevice;
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: projectId === undefined ? {} : { eas: { projectId } } };
    },
  },
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
  setNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  getPermissionsAsync: vi.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: vi.fn(() => Promise.resolve({ granted: false })),
  getExpoPushTokenAsync: (...args: unknown[]) => getExpoPushTokenAsync(...args) as unknown,
}));
vi.mock('../notifications/api', () => ({
  registerPushToken: (...a: unknown[]) => registerPushToken(...a) as unknown,
  deactivatePushToken: (...a: unknown[]) => deactivatePushToken(...a) as unknown,
}));
vi.mock('@/lib/log', () => ({ warn: (...a: unknown[]) => warn(...a) as unknown }));

const { deactivateRegisteredPushToken, registerForPush } = await import('../notifications/push');

const TOKEN = 'ExponentPushToken[abc]';

beforeEach(() => {
  vi.clearAllMocks();
  isDevice = true;
  projectId = 'proj-1';
  getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
  registerPushToken.mockResolvedValue(undefined);
  deactivatePushToken.mockResolvedValue(undefined);
});

describe('registerForPush', () => {
  it('registers the Expo token with the API', async () => {
    expect(await registerForPush()).toBe(true);
    expect(getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(registerPushToken).toHaveBeenCalledWith(TOKEN, 'android');
  });

  it('says so, and registers nothing, on an emulator', async () => {
    isDevice = false;
    expect(await registerForPush()).toBe(false);
    expect(registerPushToken).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('says so, and registers nothing, without an EAS project id', async () => {
    projectId = undefined;
    expect(await registerForPush()).toBe(false);
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

describe('deactivateRegisteredPushToken (sign-out)', () => {
  it('retires exactly the token this install registered, once', async () => {
    await registerForPush();
    await deactivateRegisteredPushToken();
    await deactivateRegisteredPushToken();
    expect(deactivatePushToken).toHaveBeenCalledTimes(1);
    expect(deactivatePushToken).toHaveBeenCalledWith(TOKEN);
  });

  it('never blocks sign-out when the DELETE fails, and logs it', async () => {
    await registerForPush();
    deactivatePushToken.mockRejectedValue(new Error('offline'));
    await expect(deactivateRegisteredPushToken()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('does nothing when no token was registered', async () => {
    await deactivateRegisteredPushToken();
    expect(deactivatePushToken).not.toHaveBeenCalled();
  });
});
