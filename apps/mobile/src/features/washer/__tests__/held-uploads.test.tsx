import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { useHeldUploads, type HeldUploads } from '../hooks/useHeldUploads';

/**
 * The registration photos keep `usePhotoSlot`'s promise (spec §6.2): a photo
 * that failed to upload stays on screen, and Retry sends THAT photo again —
 * nobody is asked to re-shoot their ID because a tower dropped a packet.
 *
 * `uploadImage` takes no intent (ADR-029): it re-signs every attempt itself.
 * These uploads have no side effect of their own to deduplicate, so the hook
 * holds no key either; the intent belongs to `createProfile` /
 * `submitDocuments`, which is where the ids are used.
 */

const mocks = vi.hoisted(() => ({ uploadImage: vi.fn() }));

vi.mock('@/lib/uploads', () => ({
  uploadImage: mocks.uploadImage,
  defaultUploadDeps: () => ({}),
}));

const FAILED = {
  ok: false,
  message: "Couldn't upload the photo. Check your connection.",
  retainedUri: 'file:///a.jpg',
};

let held: HeldUploads;

function Harness({
  folder,
  max,
}: {
  readonly folder: 'spaces' | 'documents';
  readonly max: number;
}) {
  held = useHeldUploads(folder, max);
  return null;
}

const mount = (folder: 'spaces' | 'documents' = 'spaces', max = 10) => {
  render(<Harness folder={folder} max={max} />);
};

beforeEach(() => {
  mocks.uploadImage.mockReset();
});

describe('a photo that uploads', () => {
  it('uploads to the folder it was given, with no intent argument', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'documents/id-1' });
    mount('documents', 1);

    await act(() => held.add('file:///a.jpg'));

    const call = mocks.uploadImage.mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe('file:///a.jpg');
    expect(call?.[1]).toBe('documents');
    expect(call).toHaveLength(3);
    expect(held.uploadIds).toEqual(['documents/id-1']);
    expect(held.items[0]?.uri).toBe('file:///a.jpg');
    expect(held.busy).toBe(false);
  });
});

describe('a photo that fails to upload', () => {
  it('keeps the local image and the §6 copy, and holds no id', async () => {
    mocks.uploadImage.mockResolvedValue(FAILED);
    mount();

    await act(() => held.add('file:///a.jpg'));

    expect(held.items[0]?.uri).toBe('file:///a.jpg');
    expect(held.items[0]?.error).toBe("Couldn't upload the photo. Check your connection.");
    expect(held.uploadIds).toEqual([]);
    expect(held.busy).toBe(false);
  });

  it('retries the SAME photo without a second capture', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce(FAILED)
      .mockResolvedValueOnce({ ok: true, uploadId: 'spaces/1' });
    mount();

    await act(() => held.add('file:///a.jpg'));
    const key = held.items[0]?.key ?? '';
    await act(() => held.retry(key));

    expect(mocks.uploadImage).toHaveBeenCalledTimes(2);
    expect(mocks.uploadImage.mock.calls[1]?.[0]).toBe('file:///a.jpg');
    expect(held.items).toHaveLength(1);
    expect(held.items[0]?.error).toBeNull();
    expect(held.uploadIds).toEqual(['spaces/1']);
  });

  it('does not upload a photo twice once it has an id', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'spaces/1' });
    mount();

    await act(() => held.add('file:///a.jpg'));
    await act(() => held.retry(held.items[0]?.key ?? ''));

    expect(mocks.uploadImage).toHaveBeenCalledTimes(1);
  });
});

describe('several photos', () => {
  it('keeps the ids in the order the photos were taken', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ok: true, uploadId: 'spaces/1' })
      .mockResolvedValueOnce({ ok: true, uploadId: 'spaces/2' });
    mount();

    await act(() => held.add('file:///a.jpg'));
    await act(() => held.add('file:///b.jpg'));

    expect(held.uploadIds).toEqual(['spaces/1', 'spaces/2']);
  });

  it('drops a removed photo and its id', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ok: true, uploadId: 'spaces/1' })
      .mockResolvedValueOnce({ ok: true, uploadId: 'spaces/2' });
    mount();

    await act(() => held.add('file:///a.jpg'));
    await act(() => held.add('file:///b.jpg'));
    act(() => {
      held.remove(held.items[0]?.key ?? '');
    });

    expect(held.uploadIds).toEqual(['spaces/2']);
  });

  it('replaces the one photo when the field holds one (the ID)', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ok: true, uploadId: 'documents/1' })
      .mockResolvedValueOnce({ ok: true, uploadId: 'documents/2' });
    mount('documents', 1);

    await act(() => held.add('file:///a.jpg'));
    await act(() => held.add('file:///b.jpg'));

    expect(held.items).toHaveLength(1);
    expect(held.uploadIds).toEqual(['documents/2']);
  });
});

describe('while an upload is in flight', () => {
  it('says so, so the form can hold its submit', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.uploadImage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = held.add('file:///a.jpg');
    });
    expect(held.busy).toBe(true);
    expect(held.items[0]?.uploading).toBe(true);

    await act(async () => {
      finish({ ok: true, uploadId: 'spaces/1' });
      await pending;
    });
    expect(held.busy).toBe(false);
  });

  it('ignores the answer for a photo removed before it arrived', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.uploadImage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = held.add('file:///a.jpg');
    });
    act(() => {
      held.remove(held.items[0]?.key ?? '');
    });
    await act(async () => {
      finish({ ok: true, uploadId: 'spaces/1' });
      await pending;
    });

    expect(held.items).toEqual([]);
    expect(held.uploadIds).toEqual([]);
  });
});
