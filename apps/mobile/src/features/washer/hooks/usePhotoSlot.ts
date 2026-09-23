import { useCallback, useRef, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { defaultUploadDeps, uploadImage } from '@/lib/uploads';

import { apiErrorCodeOf } from '../api/errors';
import type { PhotoSlot } from '../photo-gate';

import { useAttachPhoto } from './useWasherQueries';

/** website.md §6 copy. An attach that failed reads the same to the partner. */
const UPLOAD_FAILED = "Couldn't upload the photo. Check your connection.";

export interface PhotoSlotCapture {
  /** The local image of the capture in hand — kept through a failure. */
  readonly uri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  /**
   * This capture reached the server during this session. Describes the LOCAL
   * capture only: whether the gate is open is read from the job view's photo
   * id, never from here (T7-T1).
   */
  readonly attached: boolean;
  /** A fresh photograph: a new user intent, so a new pair of keys. */
  capture(uri: string): Promise<void>;
  /** The held photograph again, under the same keys. */
  retry(): Promise<void>;
  reset(): void;
}

interface LocalState {
  /** The job this capture belongs to; a different job sees an empty slot. */
  readonly jobId: string | null;
  readonly uri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  readonly attached: boolean;
}

interface CaptureInFlight {
  readonly jobId: string;
  readonly uri: string;
  readonly intents: { readonly sign: Intent; readonly attach: Intent };
  /** Set once Cloudinary has the file, so a retry never uploads it twice. */
  uploadId: string | null;
}

const EMPTY: LocalState = {
  jobId: null,
  uri: null,
  uploading: false,
  error: null,
  attached: false,
};

/**
 * One half of the evidence pair: capture → upload → attach, with the image
 * retained on failure (spec §3.2, §6.2).
 *
 * Valet's `useProofCapture` is the pattern, copied rather than imported
 * (R-ARCH-01). Two intents are minted per CAPTURE and held in a ref, not in
 * state: `sign` for `/me/upload-signature` and `attach` for the job's photo
 * route. They are separate mints because the server keys idempotency on the
 * header alone — one key across two endpoints comes back a 422 conflict — and
 * both are reused across every retry of that photograph (R-FE-05).
 *
 * The upload id is remembered too. A retry after a failed ATTACH replays the
 * attach alone: uploading again would mint a different id, and the same attach
 * key carrying a different body is a conflict, not a replay.
 *
 * Call it unconditionally at the top of the screen, so the capture outlives
 * whichever of skeleton, error or content the screen is rendering.
 */
export function usePhotoSlot(jobId: string | null, slot: PhotoSlot): PhotoSlotCapture {
  const attachPhoto = useAttachPhoto();
  const [local, setLocal] = useState<LocalState>(EMPTY);
  const inFlight = useRef<CaptureInFlight | null>(null);

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
        attached: false,
      });

      if (capture.uploadId === null) {
        const uploaded = await uploadImage(
          capture.uri,
          'proofs',
          capture.intents.sign,
          defaultUploadDeps(),
        );
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
          intent: capture.intents.attach,
        });
        if (!current()) return;
        setLocal((prev) => ({ ...prev, uploading: false, attached: true }));
      } catch (error) {
        if (!current()) return;
        if (apiErrorCodeOf(error) === 'PHOTO_SLOT_CLOSED') {
          // The screen was stale: the job moved on and this slot will never
          // take the photo. `useAttachPhoto` has invalidated the job, so the
          // pair re-renders from server truth; a Retry here would be a lie.
          warn(`washer.usePhotoSlot: ${slot} slot closed before the photo attached`, error);
          inFlight.current = null;
          setLocal(EMPTY);
          return;
        }
        warn(`washer.usePhotoSlot: could not attach the ${slot} photo`, error);
        setLocal((prev) => ({ ...prev, uploading: false, error: UPLOAD_FAILED }));
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
        intents: { sign: newIntent(), attach: newIntent() },
        uploadId: null,
      };
      inFlight.current = fresh;
      await run(fresh);
    },
    [jobId, run, slot],
  );

  const retry = useCallback(async () => {
    const held = inFlight.current;
    if (held?.jobId !== jobId) return;
    await run(held);
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
    attached: view.attached,
    capture,
    retry,
    reset,
  };
}
