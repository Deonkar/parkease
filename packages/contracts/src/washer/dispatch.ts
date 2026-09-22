/**
 * The dispatch constants the API and the worker must agree on.
 *
 * They live here for the reason `learnings.md` records: the API opens round 0
 * and the worker opens every round after it, and a drift between their copies
 * is not an error anywhere. The ladder would simply be wrong — a partner
 * offered at 8 km by one half and excluded at 5 km by the other, or a job that
 * waits for a fourth round that never comes. Nothing throws, nothing logs, and
 * the feature quietly under-dispatches.
 */

/**
 * §13.4. Three minutes a round, so a driver waits at most nine before we say so.
 *
 * Tighter than valet's 5/8/12 km, and deliberately. A washer carries equipment
 * to the car instead of driving the car away, so a long approach is a worse
 * trade for them and a worse experience for the driver waiting beside a parked
 * vehicle.
 */
export const WASH_OFFER_RADII_M = [3_000, 5_000, 8_000] as const;

/**
 * Three, not valet's five. A wash is less time-sensitive — the car is parked
 * and staying — so there is no need to buy speed with contention, and a smaller
 * fan-out means fewer partners opening a job that somebody else has already
 * taken.
 */
export const WASH_OFFER_FANOUT = 3;

export const WASH_ACCEPT_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * What makes `is_online` mean *reachable*.
 *
 * A phone that lost connectivity still has the flag set, so the candidate query
 * pairs it with a `last_seen_at` heartbeat inside this window. Offering a job to
 * a handset that cannot ring is how a driver waits three minutes for nothing.
 */
export const WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS = 90;

/** Outbox message types this task schedules. Named once, matched once. */
export const CARWASH_ACCEPT_TIMEOUT_JOB = 'carwash.accept-timeout';
export const CARWASH_COMPLETE_REMINDER_JOB = 'carwash.complete-reminder';
