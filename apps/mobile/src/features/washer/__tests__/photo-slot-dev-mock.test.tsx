import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { devProofUploadId } from '../api/dev-fixtures';
import { usePhotoSlot, type PhotoSlotCapture } from '../hooks/usePhotoSlot';

/**
 * Under a dev-mock session the evidence pair fills without a network upload
 * (ruling T11-W1): the browser preview has no Cloudinary signature to ask for,
 * so the slot attaches a fixture upload id instead. Outside one, the real
 * upload runs — `photo-slot.test.tsx` covers that path unchanged.
 */

const mocks = vi.hoisted(() => ({
  devMock: false,
  uploadImage: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('../dev-mock', () => ({ isWasherDevMock: () => Promise.resolve(mocks.devMock) }));

vi.mock('@/lib/uploads', () => ({
  uploadImage: mocks.uploadImage,
  defaultUploadDeps: () => ({}),
}));

vi.mock('@/lib/api', () => ({
  newIntent: () => ({ idempotencyKey: 'intent-1' }),
}));

vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

vi.mock('../hooks/useWasherQueries', () => ({
  useAttachPhoto: () => ({ mutateAsync: mocks.mutateAsync }),
}));

const JOB = '0192f2a1-0000-7000-8000-000000000001';

let slot: PhotoSlotCapture;

function Harness() {
  slot = usePhotoSlot(JOB, 'before');
  return null;
}

beforeEach(() => {
  mocks.uploadImage.mockReset();
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue({});
});

describe('the before slot', () => {
  it('under a dev-mock session, attaches a fixture id with no upload', async () => {
    mocks.devMock = true;
    render(<Harness />);

    await act(() => slot.capture('data:image/svg+xml,placeholder'));

    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB, slot: 'before', photoId: devProofUploadId('before') }),
    );
    expect(slot.attached).toBe(true);
    expect(slot.uri).toBe('data:image/svg+xml,placeholder');
  });

  it('with no dev-mock session, uploads for real', async () => {
    mocks.devMock = false;
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    render(<Harness />);

    await act(() => slot.capture('file:///a.jpg'));

    expect(mocks.uploadImage).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 'wash/before/1' }),
    );
  });
});
