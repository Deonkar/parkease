/**
 * Why an upload failed, with no dependency at all — so a node test of a caller
 * (valet's `proof.ts`) can read it without loading `lib/api.ts` and, through
 * it, `react-native`.
 */

/**
 * Why an upload failed, in the three ways a partner can act on (G4): no
 * network (try again), a refusal (the photo or the signature was not accepted:
 * take it again), or this phone could not prepare the image.
 */
export type UploadFailureReason = 'offline' | 'refused' | 'device';

/** One sentence per reason. Cloudinary's own words go to the log, never here. */
export const UPLOAD_COPY: Readonly<Record<UploadFailureReason, string>> = {
  // website.md §6 copy.
  offline: "Couldn't upload the photo. Check your connection.",
  refused: "The photo wasn't accepted. Try again, or take it again.",
  device: "Couldn't prepare the photo on this phone. Take it again.",
};

/**
 * A step of the upload failed for a known reason. Thrown by the steps and read
 * back by `uploadImage`; valet's proof flow rethrows the failure it was handed
 * so its screen says the same words.
 */
export class UploadError extends Error {
  constructor(
    readonly reason: UploadFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}
