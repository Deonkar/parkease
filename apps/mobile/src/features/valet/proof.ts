import { warn } from '@/lib/log';
import { UPLOAD_COPY, UploadError } from '@/lib/upload-failure';

/**
 * Capturing the proof photo that unlocks `parking → parked`.
 *
 * Orchestration only, with the camera and the network injected, so the part
 * that matters — that a failed upload does not cost the valet a second
 * photograph — is testable without a device.
 */

export interface ProofDeps {
  /** Compresses (R-FE-11, inside `lib/uploads.ts`) and uploads, returning the photo id. */
  upload(uri: string): Promise<string>;
}

export type ProofResult =
  | { ok: true; proofPhotoId: string }
  | { ok: false; message: string; retainedUri: string };

/**
 * Upload the captured photo.
 *
 * On any failure the ORIGINAL uri comes back so the caller can retry without
 * reopening the camera: by the time an upload fails the car is locked and the
 * valet has walked away, so a second capture is a different photograph of a
 * different thing, not a retry.
 */
export async function submitProof(uri: string, deps: ProofDeps): Promise<ProofResult> {
  try {
    const proofPhotoId = await deps.upload(uri);
    return { ok: true, proofPhotoId };
  } catch (error) {
    warn('valet.submitProof: could not attach the proof photo', error);
    return {
      ok: false,
      // The upload's own reason when it gave one (G4); anything else — the
      // attach call — is website.md §6's connection copy.
      message: error instanceof UploadError ? error.message : UPLOAD_COPY.offline,
      retainedUri: uri,
    };
  }
}
