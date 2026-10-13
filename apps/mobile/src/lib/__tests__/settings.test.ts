import { afterEach, describe, expect, it, vi } from 'vitest';

import { openAppSettings } from '../settings.web';

// S-135: react-native-web has no Linking.openSettings; the web build must explain, not throw.
describe('openAppSettings on web', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells the visitor where the browser keeps site permissions, and resolves', async () => {
    const alert = vi.fn();
    vi.stubGlobal('window', { alert });

    await expect(openAppSettings()).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/browser/i));
  });
});
