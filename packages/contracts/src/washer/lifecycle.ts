import {
  type CarwashJobEvent,
  type CarwashJobStatus,
  CarwashJobStatus as Status,
  carwashJobStatusSchema,
} from '../enums/index.js';

export {
  CARWASH_JOB_EVENT_VALUES,
  carwashJobEventSchema,
  CarwashJobEvent,
} from '../enums/carwash-job-event.js';

/**
 * The complete set of legal transitions. Nothing else is reachable.
 *
 *  requested ─offer─▶ offered ─accept─▶ accepted ─en_route─▶ en_route
 *                                                                │
 *                           start_washing ◀──────────────────────┘
 *                                │
 *                             washing ─complete─▶ completed
 *
 *  cancelled  reachable from requested, offered, accepted, en_route
 *             NOT from washing — the washer has travelled and begun
 *
 * Two edges deserve a sentence each.
 *
 * `offered --offer--> offered` is the radius expansion. The status does not
 * change; `offer_radius_m` and `offer_round` do. Modelling the widening as a
 * self-transition keeps it inside the machine instead of being a status write
 * that bypasses it — the worker widens every round after the first, and a
 * status write there would be a second, unaudited way to move a job.
 *
 * `washing` has no `cancel`, and that is a product decision rather than an
 * oversight (§13.9). Once a partner has driven to the space with their
 * equipment and started, cancelling would mean they absorb the trip and the
 * supplies. Free cancellation before `washing`; no refund after it starts.
 *
 * ---
 *
 * This table lives in `contracts` rather than in the API because the worker
 * moves jobs too: `carwash.accept-timeout` fires `offer` on every widened round
 * and `cancel` when the ladder runs out. When two deployables must agree on a
 * value, contracts owns it and both import — a second copy is a second place
 * for the machine to drift, and a drift here is not an error anywhere, it is a
 * job stuck in a state nobody can move (learnings.md).
 *
 * How a violation *surfaces* is each deployable's own business: the API throws
 * a 409, the worker throws and lets pg-boss retry. That is why this module
 * exports `nextCarwashStatus` and no assertion — an `HttpException` would drag
 * Nest into a package four consumers import, one of them a React Native app.
 */
export const CARWASH_TRANSITIONS: Readonly<
  Record<CarwashJobStatus, Readonly<Partial<Record<CarwashJobEvent, CarwashJobStatus>>>>
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
    en_route: Status.EN_ROUTE,
    cancel: Status.CANCELLED,
  },
  en_route: {
    start_washing: Status.WASHING,
    cancel: Status.CANCELLED,
  },
  washing: {
    complete: Status.COMPLETED,
    // No cancel. The washer has travelled and begun work.
  },
  completed: {},
  cancelled: {},
};

/** The status this event leads to, or `null` when the event is not legal here. */
export function nextCarwashStatus(
  from: CarwashJobStatus,
  event: CarwashJobEvent,
): CarwashJobStatus | null {
  return CARWASH_TRANSITIONS[from][event] ?? null;
}

export const isTerminalCarwashStatus = (status: CarwashJobStatus): boolean =>
  Object.keys(CARWASH_TRANSITIONS[status]).length === 0;

/**
 * While these hold, somebody still owes somebody something: a partner is on
 * their way or working, or nobody has been found yet. The "one live job per
 * partner" filter in the candidate query and the "one live wash per booking"
 * guard both read this rather than each spelling out a list that could drift.
 */
export const LIVE_CARWASH_STATUSES: readonly CarwashJobStatus[] = [
  Status.REQUESTED,
  Status.OFFERED,
  Status.ACCEPTED,
  Status.EN_ROUTE,
  Status.WASHING,
];

/**
 * When each half of the evidence pair may be written (§13.8).
 *
 * A photo is evidence of one moment, so its slot is open only while that
 * moment is the current one: `before` from accept until washing starts, and
 * `after` only while washing. Once washing has started the car's prior
 * condition is gone, and once the job is complete the pair is the record — a
 * replacement then is not a retake, it is an edit to the evidence.
 *
 * The API's attach guard enforces it and the partner app's Retake offer
 * mirrors it; both read this, so the button can never promise a write the
 * server will refuse.
 */
export const PHOTO_SLOT_OPEN_STATUSES: Readonly<
  Record<'before' | 'after', readonly CarwashJobStatus[]>
> = {
  before: [Status.ACCEPTED, Status.EN_ROUTE],
  after: [Status.WASHING],
};

/**
 * Not an HTTP failure and not friendly copy: reaching this means a caller tried
 * a move the machine forbids, which is a bug or a stale client, never a routine
 * outcome. Each deployable wraps it in whatever its transport calls a conflict.
 */
export class IllegalCarwashTransitionError extends Error {
  constructor(
    readonly from: CarwashJobStatus,
    readonly event: CarwashJobEvent,
  ) {
    super(`A car wash job in '${from}' cannot handle '${event}'`);
    this.name = 'IllegalCarwashTransitionError';
  }
}

/**
 * A status read back from the database, narrowed.
 *
 * `wash_jobs.status` is `text` with a CHECK, so a raw driver read hands back a
 * plain `string`. Parsing rather than casting is not ceremony: if a migration
 * ever adds a status the code does not know, a cast makes every transition
 * lookup silently miss, while this throws with the offending value (R-VAL-01).
 * The CHECK constraint and this schema are the two halves of the same
 * guarantee, and `enum-drift.integration.test` asserts they agree.
 */
export function parseCarwashJobStatus(value: string): CarwashJobStatus {
  const parsed = carwashJobStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`'${value}' is not a car wash job status this build knows about`);
  }
  return parsed.data;
}
