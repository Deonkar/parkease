import type { CreateWasherProfile } from '@parkease/contracts/washer';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { useRegistration, type Registration } from '../hooks/useRegistration';

/**
 * Submitting a registration (§14.2). A gig partner is TWO calls: the profile,
 * then the ID image. Each call has its own intent, minted when the partner
 * submits and replayed when THAT call is retried after a transport failure
 * (R-FE-05) — the first attempt may have landed, and the replay is how the
 * server answers it once.
 *
 * The case this file exists for: the profile lands and the ID does not. The
 * partner is registered, so they are never sent back through registration —
 * the outcome routes them to their profile, where the missing ID has its own
 * upload action.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  documents: vi.fn(),
  warn: vi.fn(),
  minted: 0,
}));

vi.mock('@/lib/api', () => ({
  newIntent: () => {
    mocks.minted += 1;
    return { idempotencyKey: `intent-${String(mocks.minted)}` };
  },
}));

vi.mock('@/lib/log', () => ({ warn: mocks.warn }));

vi.mock('../hooks/useWasherQueries', () => ({
  useCreateProfile: () => ({ mutateAsync: mocks.create }),
  useSubmitDocuments: () => ({ mutateAsync: mocks.documents }),
}));

let registration: Registration;

function Harness() {
  registration = useRegistration();
  return null;
}

const GIG = {
  partnerType: 'gig',
  businessName: 'Raju M.',
  capabilities: ['quick_wipe'],
} as CreateWasherProfile;
const BUSINESS = {
  partnerType: 'business',
  businessName: 'SparkleWash',
  businessPhotoIds: ['spaces/1'],
  capabilities: ['premium_wash'],
} as CreateWasherProfile;
const ID = { idDocumentId: 'documents/id-1' };

const OFFLINE = new Error('Network Error');
const REFUSED = { response: { status: 400, data: { error: { code: 'VALIDATION_FAILED' } } } };
const EXISTS = { response: { status: 409, data: { error: { code: 'WASHER_PROFILE_EXISTS' } } } };

const keyOf = (mock: typeof mocks.create, call: number) =>
  (mock.mock.calls[call]?.[0] as { intent: { idempotencyKey: string } } | undefined)?.intent
    .idempotencyKey;

beforeEach(() => {
  mocks.create.mockReset();
  mocks.documents.mockReset();
  mocks.warn.mockReset();
  mocks.minted = 0;
  render(<Harness />);
});

describe('a business registration', () => {
  it('is one call, carrying the business photos', async () => {
    mocks.create.mockResolvedValue({});

    const outcome = await act(() => registration.register(BUSINESS, null));

    expect(outcome).toEqual({ kind: 'registered' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ input: BUSINESS });
    expect(mocks.documents).not.toHaveBeenCalled();
  });
});

describe('a gig registration', () => {
  it('creates the profile, then sends the ID, each under its own intent', async () => {
    mocks.create.mockResolvedValue({});
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'registered' });
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ input: GIG });
    expect(mocks.documents.mock.calls[0]?.[0]).toMatchObject({ input: ID });
    expect(keyOf(mocks.create, 0)).toBe('intent-1');
    expect(keyOf(mocks.documents, 0)).toBe('intent-2');
  });

  it('routes to the profile, not back through registration, when only the ID failed', async () => {
    mocks.create.mockResolvedValue({});
    mocks.documents.mockRejectedValue(OFFLINE);

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'document-not-sent' });
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('does not send the ID when the profile was not created', async () => {
    mocks.create.mockRejectedValue(OFFLINE);

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome.kind).toBe('failed');
    expect(mocks.documents).not.toHaveBeenCalled();
  });

  /**
   * A first attempt that landed after the phone gave up on it, retried with a
   * changed field (so a new key): the server says the profile exists. That is
   * the partner being registered, not a failure — the ID still has to go.
   */
  it('treats "already registered" as registered, and still sends the ID', async () => {
    mocks.create.mockRejectedValue(EXISTS);
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'registered' });
    expect(mocks.documents).toHaveBeenCalledTimes(1);
  });
});

describe('the intent behind the profile call', () => {
  it('is replayed when the same registration is retried after a transport failure', async () => {
    mocks.create.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({});

    const first = await act(() => registration.register(BUSINESS, null));
    await act(() => registration.register(BUSINESS, null));

    expect(first).toEqual({
      kind: 'failed',
      message: "Couldn't submit. Check your connection and try again.",
    });
    expect(keyOf(mocks.create, 0)).toBe(keyOf(mocks.create, 1));
  });

  it('is new when the partner changed the form — a reused key with a new body is refused', async () => {
    mocks.create.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({});

    await act(() => registration.register(BUSINESS, null));
    await act(() => registration.register({ ...BUSINESS, businessName: 'Sparkle' }, null));

    expect(keyOf(mocks.create, 1)).not.toBe(keyOf(mocks.create, 0));
  });

  it('is new after a definite refusal, which said something about the body', async () => {
    mocks.create.mockRejectedValueOnce(REFUSED).mockResolvedValueOnce({});

    const first = await act(() => registration.register(BUSINESS, null));
    await act(() => registration.register(BUSINESS, null));

    expect(first.kind).toBe('failed');
    expect(keyOf(mocks.create, 1)).not.toBe(keyOf(mocks.create, 0));
  });
});

describe('sending the ID from the profile screen', () => {
  it('replays the same intent when the same image is retried', async () => {
    mocks.documents.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({});

    const first = await act(() => registration.sendDocument(ID));
    const second = await act(() => registration.sendDocument(ID));

    expect(first).toBe("Couldn't send your ID. Check your connection and try again.");
    expect(second).toBeNull();
    expect(keyOf(mocks.documents, 0)).toBe(keyOf(mocks.documents, 1));
  });

  it('mints a new intent for a different image', async () => {
    mocks.documents.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({});

    await act(() => registration.sendDocument(ID));
    await act(() => registration.sendDocument({ idDocumentId: 'documents/id-2' }));

    expect(keyOf(mocks.documents, 1)).not.toBe(keyOf(mocks.documents, 0));
  });
});
