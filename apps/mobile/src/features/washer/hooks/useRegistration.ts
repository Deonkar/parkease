import type { CreateWasherProfile, SubmitWasherDocuments } from '@parkease/contracts/washer';
import { useCallback, useRef, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';

import { apiErrorCodeOf, isDefiniteRefusal } from '../api/errors';

import { useCreateProfile, useSubmitDocuments } from './useWasherQueries';

export type RegistrationOutcome =
  /** Everything the form sent has landed. */
  | { readonly kind: 'registered' }
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
  const held = useRef(new Map<Call, HeldIntent>());
  const [submitting, setSubmitting] = useState(false);

  const intentFor = useCallback((call: Call, input: unknown): Intent => {
    const body = JSON.stringify(input);
    const previous = held.current.get(call);
    const intent = previous?.body === body ? previous.intent : newIntent();
    held.current.set(call, { intent, body });
    return intent;
  }, []);

  /** Whether the server's answer was final, so the key must not be replayed. */
  const settle = useCallback((call: Call, error: unknown): boolean => {
    const refused = isDefiniteRefusal(error);
    if (refused) held.current.delete(call);
    return refused;
  }, []);

  const createOnce = useCallback(
    async (input: CreateWasherProfile): Promise<string | null> => {
      try {
        await createProfile({ input, intent: intentFor('create', input) });
        held.current.delete('create');
        return null;
      } catch (error) {
        if (apiErrorCodeOf(error) === ALREADY_REGISTERED) {
          // Registered by an attempt this phone gave up on. Not a failure: the
          // partner is who the form says, and anything after this still runs.
          warn('washer.register: the profile already existed; continuing', error);
          held.current.delete('create');
          return null;
        }
        const refused = settle('create', error);
        warn(
          refused
            ? `washer.register: registration was refused (${apiErrorCodeOf(error) ?? 'no code'})`
            : 'washer.register: registration did not reach the server',
          error,
        );
        return refused ? REFUSED : OFFLINE;
      }
    },
    [createProfile, intentFor, settle],
  );

  const documentsOnce = useCallback(
    async (input: SubmitWasherDocuments): Promise<string | null> => {
      try {
        await submitDocuments({ input, intent: intentFor('documents', input) });
        held.current.delete('documents');
        return null;
      } catch (error) {
        const refused = settle('documents', error);
        warn(
          refused
            ? `washer.register: the ID was refused (${apiErrorCodeOf(error) ?? 'no code'})`
            : 'washer.register: the ID did not reach the server',
          error,
        );
        return refused ? DOCUMENT_REFUSED : DOCUMENT_OFFLINE;
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
        const failure = await createOnce(profile);
        if (failure !== null) return { kind: 'failed', message: failure };
        if (id === null) return { kind: 'registered' };
        const sent = await documentsOnce(id);
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
