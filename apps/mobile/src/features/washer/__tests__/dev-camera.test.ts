import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usesDevCamera } from '../dev-camera';

/**
 * The stand-in camera is for the browser preview only: web AND a dev-mock
 * session. An Android device always gets the real camera, dev-mock or not.
 */

const m = vi.hoisted(() => ({ os: 'web', devMock: true }));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return m.os;
    },
  },
}));

vi.mock('../dev-mock', () => ({ isWasherDevMock: () => Promise.resolve(m.devMock) }));

beforeEach(() => {
  m.os = 'web';
  m.devMock = true;
});

describe('usesDevCamera', () => {
  it('stands in on web under a dev-mock session', async () => {
    await expect(usesDevCamera()).resolves.toBe(true);
  });

  it('never stands in on Android, even under a dev-mock session', async () => {
    m.os = 'android';
    await expect(usesDevCamera()).resolves.toBe(false);
  });

  it('never stands in without a dev-mock session', async () => {
    m.devMock = false;
    await expect(usesDevCamera()).resolves.toBe(false);
  });
});
