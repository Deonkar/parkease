/**
 * The dispatch constants the API and the worker must agree on.
 *
 * They live here for the reason `learnings.md` records: the API opens round 0
 * and the worker opens every round after it, and a drift between their copies
 * is not an error anywhere. The ladder would simply be wrong — a valet offered
 * at 8 km by one half and excluded at 5 km by the other, or a job that waits
 * for a fourth round that never comes. Nothing throws, nothing logs, and the
 * feature quietly under-dispatches.
 */

/** §11.5. Two minutes a round, so a driver waits at most six before we say so. */
export const OFFER_RADII_M = [5_000, 8_000, 12_000] as const;

/**
 * The offer goes to the nearest five, all at once. Sequential offers with a
 * per-valet timeout would multiply the driver's wait by the number of valets
 * who ignore their phone.
 */
export const OFFER_FANOUT = 5;

export const ACCEPT_TIMEOUT_MS = 2 * 60 * 1000;

/** §11.8. Ten minutes after `arrived`, an absent driver owes the call-out. */
export const NO_SHOW_GRACE_MS = 10 * 60 * 1000;

/**
 * What makes `is_online` mean *reachable*.
 *
 * A phone that lost connectivity still has the flag set, so the candidate query
 * pairs it with a `last_seen_at` heartbeat inside this window. Offering a job to
 * a handset that cannot ring is how a driver waits two minutes for nothing.
 */
export const ONLINE_HEARTBEAT_WINDOW_SECONDS = 90;

/** Outbox message types this task schedules. Named once, matched once. */
export const VALET_ACCEPT_TIMEOUT_JOB = 'valet.accept-timeout';
export const VALET_NO_SHOW_JOB = 'valet.no-show';
