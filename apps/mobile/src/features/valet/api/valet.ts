import {
  setValetAvailabilitySchema,
  valetEarningsSummarySchema,
  valetJobViewSchema,
  valetOfferSchema,
  valetProfileViewSchema,
  type ValetEarningsSummary,
  type ValetJobView,
  type ValetOffer,
  type ValetProfileView,
} from '@parkease/contracts/valet';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { defaultUploadDeps, uploadImage } from '@/lib/uploads';

import type { LocationFix, SendResult } from '../location/queue';

/**
 * Every valet call goes through `lib/api.ts` (R-FE-03), including the location
 * queue drain — so it inherits auth, single-flight refresh and the retry policy
 * rather than quietly reimplementing them.
 *
 * Every response is parsed, never asserted (R-VAL-01). Money fields are read
 * and displayed; nothing here computes one (R-FE-06).
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

/** An HTTP status from a rejected call, or null when it never reached the wire. */
function statusOf(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === 'number' ? status : null;
}

/** Did this actually fail in transit, rather than throwing before the request? */
function isTransportError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string';
}

export async function fetchOffers(signal?: AbortSignal): Promise<ValetOffer[]> {
  const response = await api.get<unknown>('/valet/jobs/offers', { signal });
  return envelope(z.array(valetOfferSchema)).parse(response.data).data;
}

export async function fetchActiveJob(signal?: AbortSignal): Promise<ValetJobView | null> {
  const response = await api.get<unknown>('/valet/jobs/active', { signal });
  return envelope(valetJobViewSchema.nullable()).parse(response.data).data;
}

export async function fetchEarnings(signal?: AbortSignal): Promise<ValetEarningsSummary> {
  const response = await api.get<unknown>('/valet/earnings', { signal });
  return envelope(valetEarningsSummarySchema).parse(response.data).data;
}

export async function fetchProfile(signal?: AbortSignal): Promise<ValetProfileView> {
  const response = await api.get<unknown>('/valet/profile', { signal });
  return envelope(valetProfileViewSchema).parse(response.data).data;
}

/**
 * One key per user intent, not per HTTP attempt (R-FE-05) — so a retry after a
 * timeout replays the original accept instead of racing a second one.
 */
export async function acceptOffer(jobId: string, intent: Intent): Promise<ValetJobView> {
  const response = await api.post<unknown>(
    `/valet/jobs/${jobId}/accept`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(valetJobViewSchema).parse(response.data).data;
}

export async function advanceJob(
  jobId: string,
  event: string,
  intent: Intent,
): Promise<ValetJobView> {
  const response = await api.post<unknown>(
    `/valet/jobs/${jobId}/status`,
    { event },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(valetJobViewSchema).parse(response.data).data;
}

/**
 * The proof photo, uploaded and then attached.
 *
 * This posted `multipart/form-data` to an endpoint that parses
 * `{ proofPhotoId }` until task 14 — so it had never worked. The upload now
 * goes to Cloudinary through the shared client and only the resulting id is
 * sent here, which is what the endpoint has always asked for.
 *
 * TWO intents, not one: the sign POST (`/me/upload-signature`) and the attach
 * POST (`/valet/jobs/:id/proof`) are different endpoints, and the server's
 * idempotency store keys on the header alone while detecting drift via
 * endpoint + request hash — replaying one key against two endpoints comes
 * back `conflict` / 422 "Something changed in that request." The caller mints
 * both once per captured photo and reuses both across every retry of that
 * photo (R-FE-05).
 */
export async function uploadProof(
  uri: string,
  jobId: string,
  intents: { sign: Intent; attach: Intent },
): Promise<string> {
  const uploaded = await uploadImage(uri, 'proofs', intents.sign, defaultUploadDeps());
  if (!uploaded.ok) throw new Error(uploaded.message);

  await api.post<unknown>(
    `/valet/jobs/${jobId}/proof`,
    { proofPhotoId: uploaded.uploadId },
    { headers: { 'Idempotency-Key': intents.attach.idempotencyKey } },
  );

  return uploaded.uploadId;
}

export async function setAvailability(
  isOnline: boolean,
  intent: Intent,
  fix?: Pick<LocationFix, 'lat' | 'lng'>,
): Promise<void> {
  // `setValetAvailabilitySchema` takes a NESTED `location`, and refuses
  // `isOnline: true` without one — a valet with no position cannot be matched,
  // so the server will not let one into the pool.
  const body = setValetAvailabilitySchema.parse({
    isOnline,
    ...(fix === undefined ? {} : { location: { lat: fix.lat, lng: fix.lng } }),
  });

  await api.patch('/valet/availability', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
}

/**
 * How a queued fix reaches the server.
 *
 * REST today. The socket (`lib/socket.ts`) carries the driver-facing broadcast,
 * but nothing in this task sends a fix over it — so this is the only delivery
 * path, not a fallback behind one. It keeps `last_seen_at` fresh, which is what
 * stops the assignment query classifying a reachable valet as unreachable.
 *
 * The typed failure matters: `offline` is retried, `rejected` is dropped. A fix
 * for a job this valet is not on will be refused forever, and retrying it
 * blocks every good fix behind it (R-FAIL-01 — a handled, typed failure, not a
 * swallowed one).
 */
export async function postFix(fix: LocationFix): Promise<SendResult> {
  try {
    // A queued fix is delivered as an availability heartbeat, which is what
    // keeps `last_seen_at` fresh so the assignment query does not treat a
    // reachable valet as unreachable. It asserts `isOnline: true`, which is why
    // `stopTracking` drains BEFORE it goes offline rather than after.
    await api.patch(
      '/valet/availability',
      setValetAvailabilitySchema.parse({
        isOnline: true,
        location: { lat: fix.lat, lng: fix.lng },
      }),
      { headers: { 'Idempotency-Key': `fix-${String(fix.recordedAt)}` } },
    );
    return { ok: true };
  } catch (error) {
    const status = statusOf(error);

    // A 4xx will be a 4xx forever — a fix for a job this valet is not on, or a
    // body the server refuses. Retrying it blocks every good fix behind it.
    if (status !== null && status >= 400 && status < 500) {
      warn(`valet.postFix: server refused the fix (${String(status)})`, error);
      return { ok: false, reason: 'rejected' };
    }

    // Only a real transport failure is worth retrying. A local bug (a TypeError
    // before the request is even sent) must not masquerade as "offline" and
    // retry silently forever, so it is logged rather than quietly requeued.
    if (status === null && !isTransportError(error)) {
      warn('valet.postFix: fix could not be sent (not a transport error)', error);
    }
    return { ok: false, reason: 'offline' };
  }
}
