import { useCallback, useRef, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { defaultUploadDeps, uploadImage } from '@/lib/uploads';

import { devProofUploadId } from '../api/dev-fixtures';
import { apiErrorCodeOf, classifyFailure, failureCopy, settlesIntent } from '../api/errors';
import { isWasherDevMock } from '../dev-mock';
import type { PhotoSlot } from '../photo-gate';

import { useAttachPhoto } from './useWasherQueries';

/** website.md §6 copy. An attach that did not arrive reads the same to the partner. */
const UPLOAD_FAILED = "Couldn't upload the photo. Check your connection.";

/** The server refused the attach: the same request can never succeed (G5). */
const ATTACH_REFUSED = "This photo wasn't accepted for the job. Take it again.";

/** The job moved past this slot while the photo was on its way (G5). */
const SLOT_CLOSED = 'The job moved on before this photo arrived, so it was not needed.';

export interface PhotoSlotCapture {
  /** The local image of the capture in hand — kept through a failure. */
  readonly uri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  /**
   * Whether Retry can still work. False once the server refused the attach:
   * the intent is dropped, and only a fresh photograph (Retake) is honest.
   */
  readonly retryable: boolean;
  /** A short note that is not a failure — the job moved on past this slot. */
  readonly notice: string | null;
  /**
   * This capture reached the server during this session. Describes the LOCAL
   * capture only: whether the gate is open is read from the job view's photo
   * id, never from here (T7-T1).
   */
  readonly attached: boolean;
  /** A fresh photograph: a new user intent, so a new attach key. */
  capture(uri: string): Promise<void>;
  /** The held photograph again, under the same attach key. */
  retry(): Promise<void>;
  reset(): void;
}

interface LocalState {
  /** The job this capture belongs to; a different job sees an empty slot. */
  readonly jobId: string | null;
  readonly uri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  readonly retryable: boolean;
  readonly notice: string | null;
  readonly attached: boolean;
}

interface CaptureInFlight {
  readonly jobId: string;
  readonly uri: string;
  /** The attach intent: minted once per capture, replayed on every retry. */
  readonly attach: Intent;
  /** Set once Cloudinary has the file, so a retry never uploads it twice. */
  uploadId: string | null;
}

const EMPTY: LocalState = {
  jobId: null,
  uri: null,
  uploading: false,
  error: null,
  retryable: true,
  notice: null,
  attached: false,
};

/**
 * One half of the evidence pair: capture → upload → attach, with the image
 * retained on failure (spec §3.2, §6.2).
 *
 * Valet's `useProofCapture` is the pattern, copied rather than imported
 * (R-ARCH-01). ONE intent is minted per capture and held in a ref, not in
 * state: the attach intent, reused across every retry of that photograph
 * (R-FE-05). The upload's sign key is not ours — `uploadImage` mints a fresh
 * one per attempt, because a replayed signature goes stale (ruling T7-I1).
 *
 * The upload id is remembered too, so a retry after a failed ATTACH re-sends
 * the attach alone. That saves sending the bytes twice on a weak connection,
 * and it keeps the attach body identical under the same attach key — a second
 * upload would carry a different photo id.
 *
 * Call it unconditionally at the top of the screen, so the capture outlives
 * whichever of skeleton, error or content the screen is rendering.
 */
export function usePhotoSlot(jobId: string | null, slot: PhotoSlot): PhotoSlotCapture {
  const attachPhoto = useAttachPhoto();
  const [local, setLocal] = useState<LocalState>(EMPTY);
  const inFlight = useRef<CaptureInFlight | null>(null);
  // H7: a second Retry tap while one is running sends nothing. Read through a
  // function, because TypeScript cannot see an await change a ref.
  const retrying = useRef(false);
  const isRetrying = () => retrying.current;

  const run = useCallback(
    async (capture: CaptureInFlight) => {
      // Every await below re-checks this: a reset or a newer capture while
      // this one was on the network means its result belongs to nobody.
      const current = () => inFlight.current === capture;

      setLocal({
        jobId: capture.jobId,
        uri: capture.uri,
        uploading: true,
        error: null,
        retryable: true,
        notice: null,
        attached: false,
      });

      if (capture.uploadId === null) {
        // A dev-mock session (`__DEV__` only) has no Cloudinary to sign with,
        // so the fixture store takes a fixture id instead (ruling T11-W1).
        const uploaded = (await isWasherDevMock())
          ? { ok: true as const, uploadId: devProofUploadId(slot) }
          : await uploadImage(capture.uri, 'proofs', defaultUploadDeps());
        if (!current()) return;
        if (!uploaded.ok) {
          // `uploadImage` has already logged the cause at warn (R-FAIL-01).
          setLocal((prev) => ({ ...prev, uploading: false, error: uploaded.message }));
          return;
        }
        capture.uploadId = uploaded.uploadId;
      }

      try {
        await attachPhoto.mutateAsync({
          jobId: capture.jobId,
          slot,
          photoId: capture.uploadId,
          intent: capture.attach,
        });
        if (!current()) return;
        setLocal((prev) => ({ ...prev, uploading: false, attached: true }));
      } catch (error) {
        if (!current()) return;
        if (apiErrorCodeOf(error) === 'PHOTO_SLOT_CLOSED') {
          // The screen was stale: the job moved on and this slot will never
          // take the photo. `useAttachPhoto` has invalidated the job, so the
          // pair re-renders from server truth; a Retry here would be a lie.
          // Said, briefly, rather than the photo vanishing without a word.
          warn(`washer.usePhotoSlot: ${slot} slot closed before the photo attached`, error);
          inFlight.current = null;
          setLocal({ ...EMPTY, jobId: capture.jobId, notice: SLOT_CLOSED });
          return;
        }
        warn(
          `washer.usePhotoSlot: could not attach the ${slot} photo (${classifyFailure(error)})`,
          error,
        );
        // A refusal (or an answer this build cannot read) is final: the attach
        // intent is dropped, so no Retry can replay it forever. The photo stays
        // on screen; Retake is the way on.
        const final = settlesIntent(error);
        if (final) inFlight.current = null;
        const message = failureCopy(error, { refused: ATTACH_REFUSED, unreachable: UPLOAD_FAILED });
        setLocal((prev) => ({
          ...prev,
          uploading: false,
          error: message,
          retryable: !final,
        }));
      }
    },
    [attachPhoto, slot],
  );

  const capture = useCallback(
    async (uri: string) => {
      if (jobId === null) {
        warn(`washer.usePhotoSlot: a ${slot} photo was captured with no active job`);
        return;
      }
      const fresh: CaptureInFlight = {
        jobId,
        uri,
        attach: newIntent(),
        uploadId: null,
      };
      inFlight.current = fresh;
      await run(fresh);
    },
    [jobId, run, slot],
  );

  const retry = useCallback(async () => {
    const held = inFlight.current;
    if (held?.jobId !== jobId || isRetrying()) return;
    retrying.current = true;
    try {
      await run(held);
    } finally {
      retrying.current = false;
    }
  }, [jobId, run]);

  const reset = useCallback(() => {
    inFlight.current = null;
    setLocal(EMPTY);
  }, []);

  // A capture belongs to the job it was taken for. Derived rather than reset
  // in an effect, so there is no render in which the old job's photo shows.
  const mine = local.jobId !== null && local.jobId === jobId;
  const view = mine ? local : EMPTY;

  return {
    uri: view.uri,
    uploading: view.uploading,
    error: view.error,
    retryable: view.retryable,
    notice: view.notice,
    attached: view.attached,
    capture,
    retry,
    reset,
  };
}
