import {
  type ValetJobEvent,
  type ValetJobStatus,
  ValetJobStatus as Status,
  valetJobStatusSchema,
} from '../enums/index.js';

export {
  VALET_JOB_EVENT_VALUES,
  valetJobEventSchema,
  ValetJobEvent,
} from '../enums/valet-job-event.js';

/**
 * The complete set of legal transitions. Nothing else is reachable.
 *
 *  requested ─offer─▶ offered ─accept─▶ accepted ─depart─▶ en_route ─arrive─▶ arrived
 *                                                                               │
 *                        ┌──────────────── start_parking ───────────────────────┘
 *                        ▼
 *                     parking ─confirm_parked─▶ parked ─request_return─▶ return_requested
 *                                                 │                            │
 *                                            complete                    depart_return
 *                                                 │                            ▼
 *                                                 ▼                       returning
 *                                            completed ◀──── complete ─────────┘
 *
 *  cancelled  reachable from requested, offered, accepted, en_route, arrived
 *  no_show    reachable from arrived only
 *
 * Three edges deserve a sentence each, because none of them is obvious.
 *
 * `offered --offer--> offered` is the radius expansion. The status does not
 * change; `offer_radius_m` and `offer_round` do. Modelling the expansion as a
 * self-transition keeps it inside the machine instead of being a status write
 * that bypasses it.
 *
 * `parked --complete--> completed` exists because the return leg is optional. A
 * driver who collects their own car leaves the job at `parked`, and the booking's
 * own completion fires `complete` on it at `ends_at`. Without this edge every job
 * without a return leg would sit non-terminal forever and no earnings query could
 * ever close.
 *
 * Cancel stops at `arrived`. From `parking` onward the valet has the driver's
 * keys, and a state transition is the wrong tool for "I changed my mind while a
 * stranger is driving my car" — that is a support path with a human in it.
 *
 * ---
 *
 * This table lives in `contracts` rather than in the API because the worker
 * moves jobs too: `valet.accept-timeout` fires `offer` and `cancel`, and
 * `valet.no-show` fires `no_show`. When two deployables must agree on a value,
 * contracts owns it and both import — a second copy is a second place for the
 * machine to drift, and a drift here is not an error anywhere, it is a job stuck
 * in a state nobody can move (learnings.md).
 *
 * How a violation *surfaces* is each deployable's own business: the API throws a
 * 409, the worker throws and lets pg-boss retry. That is why this module exports
 * `nextValetStatus` and no assertion — an `HttpException` would drag Nest into
 * `contracts`, which four consumers including the mobile app import.
 */
export const VALET_TRANSITIONS: Readonly<
  Record<ValetJobStatus, Readonly<Partial<Record<ValetJobEvent, ValetJobStatus>>>>
> = {
  requested: {
    offer: Status.OFFERED,
    cancel: Status.CANCELLED,
  },
  offered: {
    accept: Status.ACCEPTED,
    offer: Status.OFFERED, // re-offer on a wider radius, same state
    cancel: Status.CANCELLED,
  },
  accepted: {
    depart: Status.EN_ROUTE,
    cancel: Status.CANCELLED,
  },
  en_route: {
    arrive: Status.ARRIVED,
    cancel: Status.CANCELLED,
  },
  arrived: {
    start_parking: Status.PARKING,
    no_show: Status.NO_SHOW,
    cancel: Status.CANCELLED,
  },
  parking: {
    confirm_parked: Status.PARKED,
  },
  parked: {
    request_return: Status.RETURN_REQUESTED,
    complete: Status.COMPLETED,
  },
  return_requested: {
    depart_return: Status.RETURNING,
  },
  returning: {
    complete: Status.COMPLETED,
  },
  completed: {},
  cancelled: {},
  no_show: {},
};

/** The status this event leads to, or `null` when the event is not legal here. */
export function nextValetStatus(from: ValetJobStatus, event: ValetJobEvent): ValetJobStatus | null {
  return VALET_TRANSITIONS[from][event] ?? null;
}

export const isTerminalValetStatus = (status: ValetJobStatus): boolean =>
  Object.keys(VALET_TRANSITIONS[status]).length === 0;

/**
 * The valet physically holds the car. Cancelling by state transition is not
 * available here, and the controller and the mobile app both read this to decide
 * whether to render a cancel button at all.
 */
export const valetHoldsVehicle = (status: ValetJobStatus): boolean =>
  status === Status.PARKING || status === Status.RETURN_REQUESTED || status === Status.RETURNING;

/**
 * While these hold, the valet's position is broadcast to the owning driver.
 *
 * Streaming stops at `parked`: the car is stationary in a space whose address the
 * driver already has, and broadcasting a parked vehicle's coordinates for hours
 * is a liability with no product value (security.md §5.3). `return_requested` is
 * absent for the same reason — the car has not moved yet.
 */
export const TRACKED_VALET_STATUSES: readonly ValetJobStatus[] = [
  Status.ACCEPTED,
  Status.EN_ROUTE,
  Status.ARRIVED,
  Status.RETURNING,
];

/**
 * Not an HTTP failure and not friendly copy: reaching this means a caller tried a
 * move the machine forbids, which is a bug or a stale client, never a routine
 * outcome. Each deployable wraps it in whatever its transport calls a conflict.
 */
export class IllegalValetTransitionError extends Error {
  constructor(
    readonly from: ValetJobStatus,
    readonly event: ValetJobEvent,
  ) {
    super(`A valet job in '${from}' cannot handle '${event}'`);
    this.name = 'IllegalValetTransitionError';
  }
}

/**
 * A status read back from the database, narrowed.
 *
 * `valet_jobs.status` is `text` with a CHECK, so a driver read hands back a
 * plain `string`. Parsing rather than casting is not ceremony: if a migration
 * ever adds a status the code does not know, a cast makes every `switch` and
 * every transition lookup silently miss, while this throws with the offending
 * value (R-VAL-01). The CHECK constraint and this schema are the two halves of
 * the same guarantee, and `enum-drift.integration.test` asserts they agree.
 */
export function parseValetJobStatus(value: string): ValetJobStatus {
  const parsed = valetJobStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`'${value}' is not a valet job status this build knows about`);
  }
  return parsed.data;
}
