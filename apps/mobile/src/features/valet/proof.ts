import { warn } from '@/lib/log';

/**
 * Capturing the proof photo that unlocks `parking → parked`.
 *
 * Orchestration only, with the camera and the network injected, so the part
 * that matters — that a failed upload does not cost the valet a second
 * photograph — is testable without a device.
 */

/** R-FE-11: the upload must land under these. */
export const PROOF_MAX_BYTES = 1_000_000;
export const PROOF_MAX_WIDTH = 1_200;
export const PROOF_QUALITY = 0.7;

export interface CompressedImage {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface ProofDeps {
  compress(uri: string, width: number, quality: number): Promise<CompressedImage>;
  upload(uri: string): Promise<string>;
}

export type ProofResult =
  | { ok: true; proofPhotoId: string }
  | { ok: false; message: string; retainedUri: string };

/**
 * Compress, then upload.
 *
 * On any failure the ORIGINAL uri comes back so the caller can retry without
 * reopening the camera: by the time an upload fails the car is locked and the
 * valet has walked away, so a second capture is a different photograph of a
 * different thing, not a retry.
 */
export async function submitProof(uri: string, deps: ProofDeps): Promise<ProofResult> {
  try {
    const compressed = await deps.compress(uri, PROOF_MAX_WIDTH, PROOF_QUALITY);
    const proofPhotoId = await deps.upload(compressed.uri);
    return { ok: true, proofPhotoId };
  } catch (error) {
    warn('valet.submitProof: could not attach the proof photo', error);
    return {
      ok: false,
      // website.md §6 copy.
      message: "Couldn't upload the photo. Check your connection.",
      retainedUri: uri,
    };
  }
}
