import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { warn } from '@/lib/log';

/**
 * Which valet and wash jobs this device has requested, per booking.
 *
 * **Why the device remembers this at all.** The server's list
 * (`GET /driver/bookings/:id/addons`) is the truth, and wins when it answers.
 * This record covers the moments it cannot: offline, and the seconds between a
 * wash Checkout succeeding and the capture webhook marking it paid, when the
 * Pay button must not invite a second payment. `mergeAddons` combines the two.
 *
 * Under the session prefix, so logout clears it with the rest of the signed-in
 * user's storage (`session-storage.ts`). Not a secret, so not secure storage.
 *
 * `paidWashJobIds` is the one fact the server does not report back: the driver
 * wash view has no payment state, so after Checkout succeeds this is what stops
 * the Pay button inviting a second payment.
 */
export const ADDONS_STORAGE_KEY = 'parkease.driver.addons';

const bookingAddonsSchema = z.object({
  valetJobId: z.string().nullable(),
  washJobIds: z.array(z.string()),
  paidWashJobIds: z.array(z.string()),
});

export type BookingAddons = z.infer<typeof bookingAddonsSchema>;

const storeSchema = z.record(bookingAddonsSchema);

type AddonsStore = z.infer<typeof storeSchema>;

export const NO_ADDONS: BookingAddons = { valetJobId: null, washJobIds: [], paidWashJobIds: [] };

async function readStore(): Promise<AddonsStore> {
  const raw = await AsyncStorage.getItem(ADDONS_STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through: a corrupt record is reported below, not thrown at a screen.
  }
  // A record we cannot read is dropped rather than crashing the booking screen,
  // but never without a trace (R-FAIL-01).
  warn('driver.addons: discarding an unreadable add-on record');
  return {};
}

export async function readBookingAddons(bookingId: string): Promise<BookingAddons> {
  const store = await readStore();
  return store[bookingId] ?? NO_ADDONS;
}

async function updateBookingAddons(
  bookingId: string,
  change: (current: BookingAddons) => BookingAddons,
): Promise<BookingAddons> {
  const store = await readStore();
  const next = change(store[bookingId] ?? NO_ADDONS);
  await AsyncStorage.setItem(ADDONS_STORAGE_KEY, JSON.stringify({ ...store, [bookingId]: next }));
  return next;
}

export function rememberValetJob(bookingId: string, jobId: string): Promise<BookingAddons> {
  return updateBookingAddons(bookingId, (current) => ({ ...current, valetJobId: jobId }));
}

export function rememberWashJob(bookingId: string, jobId: string): Promise<BookingAddons> {
  return updateBookingAddons(bookingId, (current) =>
    current.washJobIds.includes(jobId)
      ? current
      : { ...current, washJobIds: [...current.washJobIds, jobId] },
  );
}

export function rememberWashPaid(bookingId: string, jobId: string): Promise<BookingAddons> {
  return updateBookingAddons(bookingId, (current) =>
    current.paidWashJobIds.includes(jobId)
      ? current
      : { ...current, paidWashJobIds: [...current.paidWashJobIds, jobId] },
  );
}

/**
 * The server's list, plus what this device knows the server cannot yet (S-148): a job requested
 * offline-adjacent and not yet listed, and a wash paid seconds ago whose capture has not landed.
 */
export function mergeAddons(
  server: { valetJobId: string | null; washJobs: readonly { id: string; paid: boolean }[] },
  local: BookingAddons,
): BookingAddons {
  const serverWashIds = server.washJobs.map((w) => w.id);
  return {
    valetJobId: server.valetJobId ?? local.valetJobId,
    washJobIds: [...serverWashIds, ...local.washJobIds.filter((id) => !serverWashIds.includes(id))],
    paidWashJobIds: [
      ...new Set([
        ...server.washJobs.filter((w) => w.paid).map((w) => w.id),
        ...local.paidWashJobIds,
      ]),
    ],
  };
}
