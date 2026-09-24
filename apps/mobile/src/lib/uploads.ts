import {
  uploadSignatureResponseSchema,
  type RequestUploadSignature,
  type UploadSignatureResponse,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { api, newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { UploadError, UPLOAD_COPY, type UploadFailureReason } from '@/lib/upload-failure';

export { UploadError, UPLOAD_COPY, type UploadFailureReason } from '@/lib/upload-failure';

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

/** The contract's folders, never a second copy of the list (I3). */
export type UploadFolder = RequestUploadSignature['folder'];

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
  readonly compress: (uri: string, width: number, quality: number) => Promise<CompressedImage>;
  /**
   * `intent` carries the Idempotency-Key for THIS sign attempt, minted by
   * `uploadImage` — see there for why it is never reused.
   */
  readonly sign: (
    input: RequestUploadSignature,
    intent: Intent,
  ) => Promise<UploadSignatureResponse>;
  readonly put: (
    uploadUrl: string,
    fields: Record<string, string>,
    uri: string,
  ) => Promise<unknown>;
}

export type UploadResult =
  | { ok: true; uploadId: string }
  /** The ORIGINAL uri, so a retry costs no second photograph. */
  | { ok: false; reason: UploadFailureReason; message: string; retainedUri: string };

/** Cloudinary's refusal body. Parsed for the log only. */
const cloudinaryErrorSchema = z.object({ error: z.object({ message: z.string() }) });

/** Only the HTTP status of a failed call to our own API. */
const httpStatusSchema = z.object({ response: z.object({ status: z.number().int() }) });

/**
 * A step that answered is a refusal unless it answered with something a retry
 * may clear: a 5xx, a 408 or a 429. A step with no answer is offline. A body
 * this build could not parse is a refusal: retrying the same call cannot fix it.
 */
function reasonForHttp(error: unknown): UploadFailureReason {
  if (error instanceof z.ZodError) return 'refused';
  if (error instanceof UploadError) return error.reason;
  const parsed = httpStatusSchema.safeParse(error);
  if (!parsed.success) return 'offline';
  const { status } = parsed.data.response;
  return status >= 500 || status === 408 || status === 429 ? 'offline' : 'refused';
}

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
  // Each step is its own try, because which step failed is most of WHY.
  const fail = (reason: UploadFailureReason, step: string, error: unknown): UploadResult => {
    // Handled and logged, never swallowed (R-FAIL-01). The partner sees copy
    // they can act on; the cause — Cloudinary's message included — lands in
    // the log with the reason.
    warn(`uploads.uploadImage: ${step} failed for ${folder} (${reason})`, error);
    return { ok: false, reason, message: UPLOAD_COPY[reason], retainedUri: uri };
  };

  let compressed: CompressedImage;
  try {
    compressed = await deps.compress(uri, UPLOAD_MAX_WIDTH, UPLOAD_QUALITY);
  } catch (error) {
    return fail('device', 'compressing', error);
  }

  let signature: UploadSignatureResponse;
  try {
    signature = await deps.sign(
      {
        fileName: `${folder}.jpg`,
        contentType: 'image/jpeg',
        folder,
      },
      newIntent(),
    );
  } catch (error) {
    return fail(reasonForHttp(error), 'signing', error);
  }

  let raw: unknown;
  try {
    raw = await deps.put(signature.uploadUrl, signature.fields, compressed.uri);
  } catch (error) {
    // `put` throws an `UploadError` for an answer, and anything else means the
    // request never completed.
    return fail(error instanceof UploadError ? error.reason : 'offline', 'the PUT', error);
  }

  const stored = cloudinaryResponseSchema.safeParse(raw);
  if (!stored.success) return fail('refused', 'reading the upload', stored.error);
  return { ok: true, uploadId: stored.data.public_id };
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
      // An ignored non-2xx is exactly what R-FAIL-01 forbids. Cloudinary says
      // why in `error.message`, which is worth the log line (never the screen).
      if (!response.ok) {
        const status = response.status;
        let detail = 'no error message';
        try {
          const parsed = cloudinaryErrorSchema.safeParse(await response.json());
          if (parsed.success) detail = parsed.data.error.message;
        } catch (bodyError) {
          warn(`uploads.put: Cloudinary's ${String(status)} carried no JSON body`, bodyError);
        }
        const reason: UploadFailureReason =
          status >= 500 || status === 408 || status === 429 ? 'offline' : 'refused';
        throw new UploadError(reason, `cloudinary responded ${String(status)}: ${detail}`);
      }
      // `.json()` types as `any`; widen to `unknown` rather than pass an `any`
      // through — the caller still validates it with `cloudinaryResponseSchema`
      // before trusting any field (R-VAL-01).
      return (await response.json()) as unknown;
    },
  };
}
