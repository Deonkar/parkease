import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { usePhotoSlot, type PhotoSlotCapture } from '../hooks/usePhotoSlot';

/**
 * The evidence pair's one hard promise (spec §6.2, §3.2): a photo that failed to
 * upload is still on the partner's screen, and a retry replays THAT photo under
 * the SAME attach intent. By the time an upload fails the car is washed — a
 * second capture would be a photograph of a different thing.
 *
 * The sign key is not the hook's (ruling T7-I1): `uploadImage` mints one per
 * attempt, so every retry of the upload is re-signed. It is mocked here, and
 * `lib/__tests__/uploads.test.ts` proves the fresh key.
 */

const mocks = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  mutateAsync: vi.fn(),
  warn: vi.fn(),
  minted: 0,
}));

vi.mock('@/lib/uploads', () => ({
  uploadImage: mocks.uploadImage,
  defaultUploadDeps: () => ({}),
}));

vi.mock('@/lib/api', () => ({
  newIntent: () => {
    mocks.minted += 1;
    return { idempotencyKey: `intent-${String(mocks.minted)}` };
  },
}));

vi.mock('@/lib/log', () => ({ warn: mocks.warn }));

vi.mock('../hooks/useWasherQueries', () => ({
  useAttachPhoto: () => ({ mutateAsync: mocks.mutateAsync }),
}));

const JOB = '0192f2a1-0000-7000-8000-000000000001';
const OTHER_JOB = '0192f2a1-0000-7000-8000-000000000009';
const FAILED = { ok: false, message: "Couldn't upload the photo. Check your connection." };

let slot: PhotoSlotCapture;
let switchJob: (jobId: string | null) => void = () => undefined;

function Harness({ initialJobId }: { readonly initialJobId: string | null }) {
  const [jobId, setJobId] = useState(initialJobId);
  switchJob = setJobId;
  slot = usePhotoSlot(jobId, 'before');
  return null;
}

const mount = (jobId: string | null = JOB) => render(<Harness initialJobId={jobId} />);

const attachArgsOf = (call: number) =>
  mocks.mutateAsync.mock.calls[call]?.[0] as { photoId: string; intent: unknown } | undefined;

beforeEach(() => {
  mocks.uploadImage.mockReset();
  mocks.mutateAsync.mockReset();
  mocks.warn.mockReset();
  mocks.minted = 0;
});

describe('a capture that uploads', () => {
  it('uploads to proofs, then attaches under the one intent this capture minted', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockResolvedValue({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    const call = mocks.uploadImage.mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe('file:///a.jpg');
    expect(call?.[1]).toBe('proofs');
    // No sign key from the hook: `uploadImage` signs each attempt itself.
    expect(call).toHaveLength(3);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      jobId: JOB,
      slot: 'before',
      photoId: 'wash/before/1',
      intent: { idempotencyKey: 'intent-1' },
    });
    expect(mocks.minted).toBe(1);
  });

  it('keeps the local image after it attaches — the only thumbnail there is', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockResolvedValue({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.uri).toBe('file:///a.jpg');
    expect(slot.attached).toBe(true);
    expect(slot.uploading).toBe(false);
    expect(slot.error).toBeNull();
  });
});

describe('a failed upload', () => {
  it('keeps the captured uri and offers the §6 copy', async () => {
    mocks.uploadImage.mockResolvedValue({ ...FAILED, retainedUri: 'file:///a.jpg' });
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.uri).toBe('file:///a.jpg');
    expect(slot.error).toBe("Couldn't upload the photo. Check your connection.");
    expect(slot.uploading).toBe(false);
    expect(slot.attached).toBe(false);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('retries the HELD photo, re-uploading it, under the same attach intent', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ...FAILED, retainedUri: 'file:///a.jpg' })
      .mockResolvedValueOnce({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockResolvedValue({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));
    await act(() => slot.retry());

    expect(mocks.uploadImage).toHaveBeenCalledTimes(2);
    expect(mocks.uploadImage.mock.calls[1]?.[0]).toBe('file:///a.jpg');
    expect(attachArgsOf(0)?.intent).toEqual({ idempotencyKey: 'intent-1' });
    // Nothing new minted for the second attempt (R-FE-05).
    expect(mocks.minted).toBe(1);
    expect(slot.attached).toBe(true);
    expect(slot.error).toBeNull();
  });
});

describe('a failed attach', () => {
  it('replays the attach alone — same photo id, same intent — without uploading twice', async () => {
    // The file is already on Cloudinary: sending the bytes again is wasted
    // data on a weak connection, and a second upload would carry a different
    // photo id, so the replayed attach would no longer be the same request.
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));
    expect(slot.error).toBe("Couldn't upload the photo. Check your connection.");
    expect(slot.uri).toBe('file:///a.jpg');
    expect(mocks.warn).toHaveBeenCalledOnce();

    await act(() => slot.retry());

    expect(mocks.uploadImage).toHaveBeenCalledOnce();
    expect(attachArgsOf(1)).toEqual(attachArgsOf(0));
    expect(slot.attached).toBe(true);
  });

  it('drops the local capture when the server says the slot has closed', async () => {
    // PHOTO_SLOT_CLOSED means the screen was stale. The query is invalidated by
    // useAttachPhoto; holding a Retry the server will always refuse would lie.
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValue({
      response: {
        status: 409,
        data: { error: { code: 'PHOTO_SLOT_CLOSED', message: 'closed', traceId: 't' } },
      },
    });
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.uri).toBeNull();
    expect(slot.error).toBeNull();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe('an upload and an attach that both fail once', () => {
  it('re-uploads, then replays only the attach, all under the first attach intent', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ...FAILED, retainedUri: 'file:///a.jpg' })
      .mockResolvedValueOnce({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));
    await act(() => slot.retry());
    await act(() => slot.retry());

    expect(mocks.uploadImage).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    expect(attachArgsOf(0)).toEqual(attachArgsOf(1));
    expect(attachArgsOf(1)?.intent).toEqual({ idempotencyKey: 'intent-1' });
    expect(mocks.minted).toBe(1);
    expect(slot.attached).toBe(true);
  });
});

describe('intents are per capture', () => {
  it('mints a fresh attach intent for a retake', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockResolvedValue({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));
    await act(() => slot.capture('file:///b.jpg'));

    expect(mocks.minted).toBe(2);
    expect(attachArgsOf(1)?.intent).not.toEqual(attachArgsOf(0)?.intent);
  });
});

describe('the capture belongs to one job', () => {
  it('shows nothing of the last job s capture once the job changes', async () => {
    mocks.uploadImage.mockResolvedValue({ ...FAILED, retainedUri: 'file:///a.jpg' });
    mount();
    await act(() => slot.capture('file:///a.jpg'));

    act(() => {
      switchJob(OTHER_JOB);
    });

    expect(slot.uri).toBeNull();
    expect(slot.error).toBeNull();
  });

  it('ignores an upload that finishes after the capture was reset', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.uploadImage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = slot.capture('file:///a.jpg');
    });
    expect(slot.uploading).toBe(true);

    act(() => {
      slot.reset();
    });
    await act(async () => {
      finish({ ok: true, uploadId: 'wash/before/1' });
      await pending;
    });

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(slot.uri).toBeNull();
    expect(slot.uploading).toBe(false);
  });

  it('refuses to capture with no job to attach to', async () => {
    mount(null);

    await act(() => slot.capture('file:///a.jpg'));

    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

/**
 * G5: an attach the server REFUSED is told as a refusal, and its intent is
 * dropped — replaying the same refused request forever is a Retry that can
 * never work. A closed slot says, briefly, that the job moved on.
 */
describe('a refused attach', () => {
  const refusal = (status: number, code: string) => ({
    response: { status, data: { error: { code, message: `server: ${code}`, traceId: 't' } } },
  });

  it.each([
    [404, 'WASH_JOB_NOT_FOUND'],
    [403, 'FORBIDDEN'],
    [422, 'IDEMPOTENCY_KEY_REUSED'],
  ])('says a %i %s is a refusal, not the connection, and offers no Retry', async (status, code) => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValue(refusal(status, code));
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.error).not.toBeNull();
    expect(slot.error).not.toMatch(/connection/i);
    expect(slot.retryable).toBe(false);
    expect(slot.uri).toBe('file:///a.jpg');

    await act(() => slot.retry());
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps Retry for a transport failure', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Network Error'));
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.retryable).toBe(true);
  });

  it('says the job moved on when the slot has closed, instead of clearing silently', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync.mockRejectedValue(refusal(409, 'PHOTO_SLOT_CLOSED'));
    mount();

    await act(() => slot.capture('file:///a.jpg'));

    expect(slot.notice).toMatch(/moved on/i);
    expect(slot.uri).toBeNull();
    expect(slot.error).toBeNull();
  });

  it('clears that note with the next capture', async () => {
    mocks.uploadImage.mockResolvedValue({ ok: true, uploadId: 'wash/before/1' });
    mocks.mutateAsync
      .mockRejectedValueOnce(refusal(409, 'PHOTO_SLOT_CLOSED'))
      .mockResolvedValueOnce({});
    mount();

    await act(() => slot.capture('file:///a.jpg'));
    await act(() => slot.capture('file:///b.jpg'));

    expect(slot.notice).toBeNull();
  });
});

/** H7: a second Retry tap while the first is still running sends nothing. */
describe('a double-tapped Retry', () => {
  it('runs once', async () => {
    mocks.uploadImage.mockResolvedValueOnce({ ...FAILED, retainedUri: 'file:///a.jpg' });
    mount();
    await act(() => slot.capture('file:///a.jpg'));

    let finish: (value: unknown) => void = () => undefined;
    mocks.uploadImage.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.mutateAsync.mockResolvedValue({});
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = slot.retry();
      second = slot.retry();
    });
    await act(async () => {
      finish({ ok: true, uploadId: 'wash/before/1' });
      await Promise.all([first, second]);
    });

    expect(mocks.uploadImage).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
