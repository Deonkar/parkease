import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadDeps } from '@/lib/uploads';

import { render } from '../../shared/__tests__/render-native';
import { uploadProof, type HeldProof } from '../api/valet';
import { useProofCapture, type ProofCaptureState } from '../hooks/useProofCapture';

/**
 * Ruling T7-I1, valet half. The attach key is a user intent — "this photo is
 * the proof" — and is replayed on every retry of that photo (R-FE-05). The sign
 * key is not: the idempotency layer replays a stored signature for 24h and
 * Cloudinary refuses one over an hour old, so each upload attempt re-signs.
 */

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  signKeys: [] as string[],
  put: vi.fn(),
}));

vi.mock('@/lib/secure-storage', () => ({
  secureStorage: { read: vi.fn(), write: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { post: mocks.post },
}));

vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

// The REAL `uploadImage`, over fake device deps — so the sign key it mints is
// what this suite observes.
vi.mock('@/lib/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads')>();
  const fake: UploadDeps = {
    compress: (uri) => Promise.resolve({ uri, width: 1, height: 1 }),
    sign: (_input, intent) => {
      mocks.signKeys.push(intent.idempotencyKey);
      return Promise.resolve({
        uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
        publicUrl: 'https://res.cloudinary.com/demo/image/upload/p',
        fields: { signature: 's' },
        expiresAt: '2026-09-23T06:10:00.000Z',
      });
    },
    put: () => mocks.put() as Promise<unknown>,
  };
  return { ...actual, defaultUploadDeps: () => fake };
});

const JOB = '0192f2a1-0000-7000-8000-000000000001';
const ATTACH = { idempotencyKey: '0192f2a1-0000-7000-8000-00000000000a' };

const held = (): HeldProof => ({ attach: ATTACH, uploadId: null });
const postedKeys = () =>
  mocks.post.mock.calls.map(
    (call) => (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
  );
const postedBodies = () => mocks.post.mock.calls.map((call) => call[1] as unknown);

beforeEach(() => {
  mocks.post.mockReset();
  mocks.put.mockReset();
  mocks.signKeys.length = 0;
});

describe('uploadProof', () => {
  it('re-signs an upload that failed, under a fresh key each attempt', async () => {
    mocks.put
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ public_id: 'proofs/1' });
    mocks.post.mockResolvedValue({});
    const proof = held();

    await expect(uploadProof('file:///a.jpg', JOB, proof)).rejects.toThrow();
    await uploadProof('file:///a.jpg', JOB, proof);

    expect(mocks.signKeys).toHaveLength(2);
    expect(mocks.signKeys[0]).not.toBe(mocks.signKeys[1]);
    expect(postedKeys()).toEqual([ATTACH.idempotencyKey]);
  });

  it('replays a failed attach under the SAME key with the SAME body, uploading once', async () => {
    // A second upload would carry a different photo id: the same attach key
    // with a different body is not a replay of the first attempt.
    mocks.put.mockResolvedValue({ public_id: 'proofs/1' });
    mocks.post.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    const proof = held();

    await expect(uploadProof('file:///a.jpg', JOB, proof)).rejects.toThrow();
    await uploadProof('file:///a.jpg', JOB, proof);

    expect(mocks.put).toHaveBeenCalledOnce();
    expect(postedKeys()).toEqual([ATTACH.idempotencyKey, ATTACH.idempotencyKey]);
    expect(postedBodies()[1]).toEqual(postedBodies()[0]);
  });
});

describe('useProofCapture', () => {
  let proof: ProofCaptureState;
  function Harness() {
    proof = useProofCapture(JOB);
    return null;
  }

  it('replays the attach key across a retry, and mints a new one for a new photo', async () => {
    mocks.put
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ public_id: 'proofs/1' });
    mocks.post.mockResolvedValue({});
    render(<Harness />);

    await act(() => proof.attach('file:///a.jpg'));
    expect(proof.error).not.toBeNull();
    expect(proof.uri).toBe('file:///a.jpg');

    await act(() => proof.retry());
    await act(() => proof.attach('file:///b.jpg'));

    const [first, second] = postedKeys();
    expect(proof.attached).toBe(true);
    // The retry's single POST and the new photo's POST: different intents.
    expect(postedKeys()).toHaveLength(2);
    expect(first).not.toBe(second);
    // Every upload attempt signed afresh: failed, retried, new photo.
    expect(new Set(mocks.signKeys).size).toBe(3);
  });

  it('retries under the key the capture minted, not a new one', async () => {
    mocks.put.mockResolvedValue({ public_id: 'proofs/1' });
    mocks.post.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    render(<Harness />);

    await act(() => proof.attach('file:///a.jpg'));
    await act(() => proof.retry());

    const [first, second] = postedKeys();
    expect(first).toBe(second);
    expect(proof.attached).toBe(true);
  });
});
