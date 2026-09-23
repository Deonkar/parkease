import {
  uploadSignatureResponseSchema,
  type UploadSignatureResponse,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { api, newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';

/**
 * The one way a file leaves this app.
 *
 * Shared rather than per-feature because this is the second consumer and the
 * two must change together when the storage provider does (R-ARCH-07). The
 * first consumer — valet's proof photo — was posting `multipart/form-data` to
 * an endpoint that parses a JSON upload id, so it had never worked; see
 * `learnings.md`, "A shared Zod contract does not make the client and the
 * server agree about the wire".
 *
 * The shape is compress → sign → PUT → id, and the id is what every attach
 * endpoint wants. A client-supplied URL is refused by contract
 * (`attachWashPhotoSchema`) for a good reason: it would let a partner point
 * the evidence trail at any image on the internet.
 */

export type UploadFolder = 'spaces' | 'documents' | 'avatars' | 'reviews' | 'proofs';

/**
 * R-FE-11's two limits this module can actually enforce. The rule also sets a
 * byte ceiling, but `expo-image-manipulator` returns no byte size to check it
 * against, so it is not asserted here — see the task-14 ruling on
 * `UPLOAD_MAX_BYTES`. It remains a review-time and Maestro-time check.
 */
export const UPLOAD_MAX_WIDTH = 1_200;
export const UPLOAD_QUALITY = 0.7;

export interface CompressedImage {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface UploadDeps {
  compress(uri: string, width: number, quality: number): Promise<CompressedImage>;
  /**
   * `intent` carries the Idempotency-Key for THIS sign attempt, minted by
   * `uploadImage` — see there for why it is never reused.
   */
  sign(
    input: { fileName: string; contentType: string; folder: UploadFolder },
    intent: Intent,
  ): Promise<UploadSignatureResponse>;
  put(uploadUrl: string, fields: Record<string, string>, uri: string): Promise<unknown>;
}

export type UploadResult =
  | { ok: true; uploadId: string }
  /** The ORIGINAL uri, so a retry costs no second photograph. */
  | { ok: false; message: string; retainedUri: string };

/**
 * Cloudinary's answer is data from outside the process, so it is parsed and
 * never asserted (R-VAL-01). `public_id` is the only field we consume.
 */
const cloudinaryResponseSchema = z.object({ public_id: z.string().min(1) });

/**
 * The sign key is minted HERE, fresh on every call, and callers own only the
 * key for whatever attaches the resulting id (ruling T7-I1).
 *
 * The two keys have different jobs. An attach key stands for a user intent —
 * "this photo is the evidence" — and is reused across every retry of that
 * photo so a replay cannot record it twice (R-FE-05). Signing has no side
 * effect to deduplicate: it computes an HMAC over a fresh `public_id`. And the
 * idempotency layer replays a stored response for 24h, so a reused sign key
 * would hand every retry the SAME Cloudinary `timestamp` — which Cloudinary
 * refuses once it is an hour old. The commonest outdoor failure (sign fine,
 * PUT fails) would then fail every retry for a day.
 */
export async function uploadImage(
  uri: string,
  folder: UploadFolder,
  deps: UploadDeps,
): Promise<UploadResult> {
  try {
    const compressed = await deps.compress(uri, UPLOAD_MAX_WIDTH, UPLOAD_QUALITY);

    const signature = await deps.sign(
      {
        fileName: `${folder}.jpg`,
        contentType: 'image/jpeg',
        folder,
      },
      newIntent(),
    );

    const raw = await deps.put(signature.uploadUrl, signature.fields, compressed.uri);

    return { ok: true, uploadId: cloudinaryResponseSchema.parse(raw).public_id };
  } catch (error) {
    // Handled and logged, never swallowed (R-FAIL-01). The partner sees copy
    // they can act on; the trace lands in the log with the reason.
    warn(`uploads.uploadImage: could not upload to ${folder}`, error);
    return {
      ok: false,
      // website.md §6 copy.
      message: "Couldn't upload the photo. Check your connection.",
      retainedUri: uri,
    };
  }
}

/** The real device implementation. Injected so the orchestration above is testable. */
export function defaultUploadDeps(): UploadDeps {
  return {
    compress: async (source, width, quality) => {
      // Imported dynamically, not at module scope: `expo-image-manipulator`
      // pulls in `expo-modules-core`, which reads `__DEV__` and other RN
      // globals at import time. A node-environment test that only exercises
      // `uploadImage` (never `defaultUploadDeps`) must never pay for that load
      // — see learnings.md, "A node-environment test that imports react-native
      // fails as Expected 'from', got 'typeOf'".
      const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
      // SDK 57's contextual API. `manipulateAsync` is deprecated and eslint's
      // no-deprecated rule fails the build on it.
      const rendered = await ImageManipulator.manipulate(source).resize({ width }).renderAsync();
      const result = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
      return { uri: result.uri, width: result.width, height: result.height };
    },

    // Through `lib/api.ts` (R-FE-03), so it inherits auth and single-flight
    // refresh.
    //
    // `/me/upload-signature` is a POST, and `lib/api.ts`'s request
    // interceptor throws synchronously for any non-GET/HEAD request with no
    // `Idempotency-Key` header — the server's `IdempotencyInterceptor` agrees
    // (only GET/HEAD and `/api/v1/webhooks/` are exempt). Without this header
    // every real upload threw here before it ever reached the network.
    sign: async (input, intent) => {
      const response = await api.post<unknown>('/me/upload-signature', input, {
        headers: { 'Idempotency-Key': intent.idempotencyKey },
      });
      return uploadSignatureResponseSchema.parse(
        z.object({ data: z.unknown() }).parse(response.data).data,
      );
    },

    // Cloudinary is NOT our API: it takes the signed fields as multipart and
    // must not carry our Authorization header, so it does not go through
    // `lib/api.ts`. This is the one deliberate exception to R-FE-03, and it is
    // an exception because the destination is a third party.
    put: async (uploadUrl, fields, uri) => {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, value);
      // React Native's documented FormData file shape; not an assertion on
      // data from outside the process.
      body.append('file', { uri, name: 'upload.jpg', type: 'image/jpeg' } as unknown as Blob);

      const response = await fetch(uploadUrl, { method: 'POST', body });
      // An ignored non-2xx is exactly what R-FAIL-01 forbids.
      if (!response.ok) {
        throw new Error(`cloudinary responded ${String(response.status)}`);
      }
      // `.json()` types as `any`; widen to `unknown` rather than pass an `any`
      // through — the caller still validates it with `cloudinaryResponseSchema`
      // before trusting any field (R-VAL-01).
      return (await response.json()) as unknown;
    },
  };
}
