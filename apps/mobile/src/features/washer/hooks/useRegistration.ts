import type { CreateWasherProfile, SubmitWasherDocuments } from '@parkease/contracts/washer';
import { useCallback, useRef, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';

import { apiErrorCodeOf, classifyFailure, failureCopy, settlesIntent } from '../api/errors';
import { matchesStoredProfile } from '../registration';

import { useCreateProfile, useRefreshProfile, useSubmitDocuments } from './useWasherQueries';

export type RegistrationOutcome =
  /** Everything the form sent has landed. */
  | { readonly kind: 'registered' }
  /**
   * An earlier attempt had already registered this partner, with details that
   * differ from what this form sent (G6). They are registered, and the profile
   * says "check your details" rather than pretending the edit landed.
   */
  | { readonly kind: 'already-registered' }
  /**
   * The profile exists and the ID did not send. The partner is registered, so
   * they go to their profile — which shows the missing ID with its own upload
   * action — and are never sent back through registration.
   */
  | { readonly kind: 'document-not-sent' }
  /** Nothing was registered; the form stays, with this said near its submit. */
  | { readonly kind: 'failed'; readonly message: string };

export interface Registration {
  /** A gig partner passes their ID image; a business passes `null`. Never rejects. */
  readonly register: (
    profile: CreateWasherProfile,
    documents: SubmitWasherDocuments | null,
  ) => Promise<RegistrationOutcome>;
  /** The ID image on its own, from the profile screen. `null` once sent, else why not. */
  readonly sendDocument: (documents: SubmitWasherDocuments) => Promise<string | null>;
  readonly submitting: boolean;
}

const OFFLINE = "Couldn't submit. Check your connection and try again.";
const REFUSED = "We couldn't accept these details. Check them and try again.";
const DOCUMENT_OFFLINE = "Couldn't send your ID. Check your connection and try again.";
const DOCUMENT_REFUSED = "We couldn't accept this photo. Take it again and send it.";

/** The 409 for a partner who already has a profile — an earlier attempt landed. */
const ALREADY_REGISTERED = 'WASHER_PROFILE_EXISTS';

interface HeldIntent {
  readonly intent: Intent;
  /** The body this intent was minted for: a reused key with a new body is refused (422). */
  readonly body: string;
}

type Call = 'create' | 'documents';

type CreateResult =
  | { readonly ok: true; readonly differs: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Submitting a registration (§14.2, R-FE-05).
 *
 * TWO calls for a gig partner — the profile, then the ID image — and each has
 * its own intent, minted when the partner submits and replayed when THAT call
 * is retried with the same body after a transport failure: the first attempt
 * may have landed, and the replay is how the server answers it once. A changed
 * body, a success or a definite refusal drops the key.
 *
 * `mutateAsync` so the second call can follow the first in one function.
 */
export function useRegistration(): Registration {
  const { mutateAsync: createProfile } = useCreateProfile();
  const { mutateAsync: submitDocuments } = useSubmitDocuments();
  const refreshProfile = useRefreshProfile();
  const held = useRef(new Map<Call, HeldIntent>());
  const [submitting, setSubmitting] = useState(false);

  const intentFor = useCallback((call: Call, input: unknown): Intent => {
    const body = JSON.stringify(input);
    const previous = held.current.get(call);
    const intent = previous?.body === body ? previous.intent : newIntent();
    held.current.set(call, { intent, body });
    return intent;
  }, []);

  /** A final answer (a refusal, or one this build cannot read) drops the key (G1). */
  const settle = useCallback((call: Call, error: unknown) => {
    if (settlesIntent(error)) held.current.delete(call);
  }, []);

  /** Whether the server holds what was sent; unreadable counts as "check it". */
  const storedMatches = useCallback(
    async (input: CreateWasherProfile): Promise<boolean> => {
      try {
        return matchesStoredProfile(input, await refreshProfile());
      } catch (error) {
        warn('washer.register: could not read back the existing profile', error);
        return false;
      }
    },
    [refreshProfile],
  );

  const createOnce = useCallback(
    async (input: CreateWasherProfile): Promise<CreateResult> => {
      try {
        await createProfile({ input, intent: intentFor('create', input) });
        held.current.delete('create');
        return { ok: true, differs: false };
      } catch (error) {
        if (apiErrorCodeOf(error) === ALREADY_REGISTERED) {
          // Registered by an attempt this phone gave up on. Not a failure: the
          // partner is registered, and anything after this still runs. But the
          // server kept THAT attempt's details, so they are compared (G6).
          warn('washer.register: the profile already existed; continuing', error);
          held.current.delete('create');
          return { ok: true, differs: !(await storedMatches(input)) };
        }
        settle('create', error);
        warn(
          `washer.register: registration failed (${classifyFailure(error)}, ${apiErrorCodeOf(error) ?? 'no code'})`,
          error,
        );
        return {
          ok: false,
          message: failureCopy(error, { refused: REFUSED, unreachable: OFFLINE }),
        };
      }
    },
    [createProfile, intentFor, settle, storedMatches],
  );

  const documentsOnce = useCallback(
    async (input: SubmitWasherDocuments): Promise<string | null> => {
      try {
        await submitDocuments({ input, intent: intentFor('documents', input) });
        held.current.delete('documents');
        return null;
      } catch (error) {
        settle('documents', error);
        warn(
          `washer.register: the ID failed (${classifyFailure(error)}, ${apiErrorCodeOf(error) ?? 'no code'})`,
          error,
        );
        return failureCopy(error, { refused: DOCUMENT_REFUSED, unreachable: DOCUMENT_OFFLINE });
      }
    },
    [submitDocuments, intentFor, settle],
  );

  const register = useCallback(
    async (
      profile: CreateWasherProfile,
      id: SubmitWasherDocuments | null,
    ): Promise<RegistrationOutcome> => {
      setSubmitting(true);
      try {
        const created = await createOnce(profile);
        if (!created.ok) return { kind: 'failed', message: created.message };
        const sent = id === null ? null : await documentsOnce(id);
        // Details that differ outrank a missing ID: the profile screen shows
        // the missing ID with its own action either way.
        if (created.differs) return { kind: 'already-registered' };
        return sent === null ? { kind: 'registered' } : { kind: 'document-not-sent' };
      } finally {
        setSubmitting(false);
      }
    },
    [createOnce, documentsOnce],
  );

  const sendDocument = useCallback(
    async (id: SubmitWasherDocuments): Promise<string | null> => {
      setSubmitting(true);
      try {
        return await documentsOnce(id);
      } finally {
        setSubmitting(false);
      }
    },
    [documentsOnce],
  );

  return { register, sendDocument, submitting };
}
