import {
  washerProfileViewSchema,
  type CreateWasherProfile,
  type WasherProfileView,
} from '@parkease/contracts/washer';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { render } from '../../shared/__tests__/render-native';
import { IN_FLIGHT_COPY, OUTDATED_COPY } from '../api/errors';
import { leavesIdUnsent, useRegistration, type Registration } from '../hooks/useRegistration';

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
  refreshProfile: vi.fn(),
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
  useRefreshProfile: () => mocks.refreshProfile,
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
  businessPhotoIds: ['parkease/spaces/1'],
  capabilities: ['premium_wash'],
} as CreateWasherProfile;
const ID = { idDocumentId: 'parkease/documents/id-1' };

/** What `GET /washer/profile` holds for the GIG form above, parsed like the wire. */
const stored = (overrides: Partial<WasherProfileView> = {}): WasherProfileView =>
  washerProfileViewSchema.parse({
    partnerType: 'gig',
    businessName: 'Raju M.',
    gstin: null,
    businessPhotoIds: [],
    operatingHours: null,
    capabilities: ['quick_wipe'],
    idDocumentId: null,
    verificationStatus: 'unverified',
    isOnline: false,
    lastSeenAt: null,
    ratingAvgBp: null,
    ratingCount: 0,
    ...overrides,
  });

const OFFLINE = new Error('Network Error');
const REFUSED = { response: { status: 400, data: { error: { code: 'VALIDATION_FAILED' } } } };
const EXISTS = { response: { status: 409, data: { error: { code: 'WASHER_PROFILE_EXISTS' } } } };

const keyOf = (mock: typeof mocks.create, call: number) =>
  (mock.mock.calls[call]?.[0] as { intent: { idempotencyKey: string } } | undefined)?.intent
    .idempotencyKey;

beforeEach(() => {
  mocks.create.mockReset();
  mocks.documents.mockReset();
  mocks.refreshProfile.mockReset();
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
    mocks.refreshProfile.mockResolvedValue(stored());
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'registered' });
    expect(mocks.documents).toHaveBeenCalledTimes(1);
  });
});

/**
 * G6: "already registered" is only "registered" when what the server holds is
 * what this form sent. A retry after the partner EDITED the form lands on the
 * first attempt's profile, and quietly calling that success hides their edit.
 */
describe('already registered, with different details', () => {
  it('refetches the profile and says so when it differs from what was sent', async () => {
    mocks.create.mockRejectedValue(EXISTS);
    mocks.refreshProfile.mockResolvedValue(stored({ businessName: 'Raju' }));
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'already-registered', idNotSent: false });
    // The partner IS registered, so the ID still goes.
    expect(mocks.documents).toHaveBeenCalledTimes(1);
  });

  it('is plain registered when the stored profile matches, capabilities in any order', async () => {
    mocks.create.mockRejectedValue(EXISTS);
    mocks.refreshProfile.mockResolvedValue(stored({ capabilities: ['quick_wipe'] }));
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'registered' });
  });

  it('says check your details when the profile cannot be read back', async () => {
    mocks.create.mockRejectedValue(EXISTS);
    mocks.refreshProfile.mockRejectedValue(OFFLINE);
    mocks.documents.mockResolvedValue({});

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'already-registered', idNotSent: false });
    expect(mocks.warn).toHaveBeenCalled();
  });
});

/**
 * N2: "already registered with different details" whose ID call ALSO failed.
 * The ID image is on Cloudinary; only its call did not land, so the outcome
 * says so and the register screen holds the upload for the profile to resend.
 */
describe('already registered, and the ID did not send', () => {
  it('says the ID is still unsent', async () => {
    mocks.create.mockRejectedValue(EXISTS);
    mocks.refreshProfile.mockResolvedValue(stored({ businessName: 'Raju' }));
    mocks.documents.mockRejectedValue(OFFLINE);

    const outcome = await act(() => registration.register(GIG, ID));

    expect(outcome).toEqual({ kind: 'already-registered', idNotSent: true });
  });

  it('is what decides whether the uploaded ID is held', () => {
    expect(leavesIdUnsent({ kind: 'document-not-sent' })).toBe(true);
    expect(leavesIdUnsent({ kind: 'already-registered', idNotSent: true })).toBe(true);
    expect(leavesIdUnsent({ kind: 'already-registered', idNotSent: false })).toBe(false);
    expect(leavesIdUnsent({ kind: 'registered' })).toBe(false);
    expect(leavesIdUnsent({ kind: 'failed', message: 'm' })).toBe(false);
  });
});

/** G1: the classes that mean the same thing everywhere. */
describe('an out-of-date app and a call still in flight', () => {
  it('says "Update the app" when the answer could not be read', async () => {
    mocks.create.mockRejectedValue(new ZodError([]));

    const outcome = await act(() => registration.register(BUSINESS, null));

    expect(outcome).toMatchObject({ kind: 'failed', message: OUTDATED_COPY });
  });

  it('says the first attempt is still being processed', async () => {
    mocks.create.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'REQUEST_IN_FLIGHT', message: 'm' } } },
    });

    const outcome = await act(() => registration.register(BUSINESS, null));

    expect(outcome).toMatchObject({ kind: 'failed', message: IN_FLIGHT_COPY });
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

    expect(first).toEqual({
      kind: 'failed',
      message: "Couldn't send your ID. Check your connection and try again.",
      retake: false,
    });
    expect(second).toEqual({ kind: 'sent' });
    expect(keyOf(mocks.documents, 0)).toBe(keyOf(mocks.documents, 1));
  });

  it('mints a new intent for a different image', async () => {
    mocks.documents.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({});

    await act(() => registration.sendDocument(ID));
    await act(() => registration.sendDocument({ idDocumentId: 'documents/id-2' }));

    expect(keyOf(mocks.documents, 1)).not.toBe(keyOf(mocks.documents, 0));
  });
});

/**
 * N3: an ID the server REFUSED is never sent again. Re-sending the same upload
 * id is refused the same way forever, so the result asks for a new photo.
 */
describe('an ID the server refused', () => {
  it('asks for a new photo rather than a resend', async () => {
    mocks.documents.mockRejectedValue(REFUSED);

    const result = await act(() => registration.sendDocument(ID));

    expect(result).toEqual({
      kind: 'failed',
      message: "We couldn't accept this photo. Take it again and send it.",
      retake: true,
    });
  });

  it('keeps the photo when the call only failed to arrive', async () => {
    mocks.documents.mockRejectedValue(OFFLINE);

    const result = await act(() => registration.sendDocument(ID));

    expect(result).toMatchObject({ kind: 'failed', retake: false });
  });
});
