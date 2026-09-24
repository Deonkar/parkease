import { act, forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { byTestId, mount, nodes } from '../../shared/__tests__/render-native';
import { WashCamera } from '../components/WashCamera';

/**
 * The full-screen camera (G9, J4, H7).
 *
 * - A capture that comes back with no photo says so; it used to close the
 *   camera and log, and the partner saw nothing happen.
 * - Until the dev-mock answer is in, neither the real camera nor the stand-in
 *   is mounted, and the shutter does nothing — so the first frame never opens
 *   the real camera in the browser preview.
 * - A double-tapped shutter takes one photo.
 */

const m = vi.hoisted(() => ({
  takePicture: vi.fn(),
  alert: vi.fn(),
  devCamera: null as ((answer: boolean) => void) | null,
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Modal: 'Modal',
  Alert: { alert: m.alert },
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('expo-camera', () => ({
  CameraView: forwardRef(function CameraView(_props: object, ref) {
    useImperativeHandle(ref, () => ({ takePictureAsync: m.takePicture }));
    return 'real-camera';
  }),
}));

vi.mock('../dev-camera', () => ({
  usesDevCamera: () =>
    new Promise<boolean>((resolve) => {
      m.devCamera = resolve;
    }),
}));

vi.mock('../api/dev-fixtures', () => ({ DEV_PLACEHOLDER_PHOTO_URI: 'data:placeholder' }));
vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

const shutter = (view: ReturnType<typeof mount>) => {
  const node = byTestId(view.tree(), 'wash-camera-shutter');
  if (node === undefined) throw new Error('no shutter');
  return node.props['onPress'] as () => void;
};

const renders = (view: ReturnType<typeof mount>, what: string) =>
  JSON.stringify(view.tree()).includes(what);

function openCamera(onCaptured = vi.fn(), onClose = vi.fn()) {
  const view = mount(<WashCamera slot="before" onCaptured={onCaptured} onClose={onClose} />);
  return { view, onCaptured, onClose };
}

async function answerDevCamera(answer: boolean) {
  await act(async () => {
    m.devCamera?.(answer);
    await Promise.resolve();
  });
}

beforeEach(() => {
  m.takePicture.mockReset();
  m.alert.mockReset();
  m.devCamera = null;
});

describe('before the dev-camera answer is in (J4)', () => {
  it('mounts neither the real camera nor the stand-in', () => {
    const { view } = openCamera();

    expect(renders(view, 'real-camera')).toBe(false);
    expect(renders(view, 'Dev preview')).toBe(false);
  });

  it('ignores the shutter', async () => {
    const { view, onCaptured } = openCamera();

    await act(async () => {
      shutter(view)();
      await Promise.resolve();
    });

    expect(m.takePicture).not.toHaveBeenCalled();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('mounts the real camera once the answer is "no stand-in"', async () => {
    const { view } = openCamera();
    await answerDevCamera(false);

    expect(renders(view, 'real-camera')).toBe(true);
  });
});

describe('a capture that returns no photo (G9)', () => {
  it('says so instead of closing on nothing', async () => {
    const { view, onCaptured } = openCamera();
    await answerDevCamera(false);
    m.takePicture.mockResolvedValue(undefined);

    await act(async () => {
      shutter(view)();
      await Promise.resolve();
    });

    expect(onCaptured).not.toHaveBeenCalled();
    expect(m.alert).toHaveBeenCalledTimes(1);
  });
});

describe('a double-tapped shutter (H7)', () => {
  it('takes one photo', async () => {
    const { view, onCaptured } = openCamera();
    await answerDevCamera(false);
    let finish: (value: { uri: string }) => void = () => undefined;
    m.takePicture.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    await act(async () => {
      const press = shutter(view);
      press();
      press();
      finish({ uri: 'file:///shot.jpg' });
      await Promise.resolve();
    });

    expect(m.takePicture).toHaveBeenCalledTimes(1);
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(nodes(view.tree()).length).toBeGreaterThan(0);
  });
});
