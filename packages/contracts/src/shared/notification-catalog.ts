/**
 * The one place a notification is defined: its category, its copy, where a tap lands, and which
 * outbox events produce it. The worker renders and the API reads from this single table, because
 * two deployables that must agree on a template key fail silently when they drift (learnings.md).
 *
 * Copy follows website.md §5 without the emoji — the project rule is no emoji as an icon.
 * Every field a body reads is optional: a producer sends what it has, and the copy degrades to a
 * sentence that is still true instead of printing "undefined".
 */

export const NOTIFICATION_CATEGORIES = [
  'bookings',
  'valet',
  'carwash',
  'jobs',
  'spaces',
  'payouts',
  'reviews',
  'account',
  'promotions',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Promotions are opt-in. v1 defaulted them on, so every install got marketing it never asked for. */
export const DEFAULT_PUSH_ENABLED: Readonly<Record<NotificationCategory, boolean>> = {
  bookings: true,
  valet: true,
  carwash: true,
  jobs: true,
  spaces: true,
  payouts: true,
  reviews: true,
  account: true,
  promotions: false,
};

type Data = Readonly<Record<string, unknown>>;

interface Entry {
  readonly category: NotificationCategory;
  /** Something the user can fix; the feed pins these above the rest. */
  readonly actionable?: true;
  readonly title: string;
  readonly body: (d: Data) => string;
  /** An Expo Router path. Authorisation is checked at the destination, not here. */
  readonly link: (d: Data) => string | null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Integer paise to "₹3,200". Display only; no money is computed here. */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const booking = (d: Data): string | null =>
  str(d.bookingId) === undefined ? null : `/(driver)/bookings/${String(d.bookingId)}`;
const job = (d: Data): string | null => (str(d.jobId) === undefined ? null : `/(driver)/bookings`);
const listing = (d: Data): string | null =>
  str(d.spaceId) === undefined ? null : `/(owner)/listings/${String(d.spaceId)}`;
const payouts = (): string => '/(owner)/earnings/payouts';

export const NOTIFICATION_CATALOG = {
  'booking.confirmed': {
    category: 'bookings',
    title: 'Booking confirmed',
    body: () => 'Your spot is reserved. Open the booking for directions and your pass.',
    link: booking,
  },
  'booking.remind': {
    category: 'bookings',
    title: 'Parking in 30 min',
    body: (d) => `Your spot at ${str(d.spaceName) ?? 'your space'} is ready soon.`,
    link: booking,
  },
  'booking.cancelled': {
    category: 'bookings',
    title: 'Booking cancelled',
    body: () => 'Your booking has been cancelled. Any refund is on its way.',
    link: booking,
  },
  'review.request': {
    category: 'reviews',
    title: 'How was your parking?',
    body: () => 'Rate your stay. It takes a few seconds and helps the next driver.',
    link: booking,
  },
  'valet.assigned': {
    category: 'valet',
    title: 'Valet on the way',
    body: () => 'A valet accepted your request and is heading to you.',
    link: job,
  },
  'valet.parked': {
    category: 'valet',
    title: 'Your car is parked',
    body: () => 'Your valet has parked your car. Photo proof is in the job.',
    link: job,
  },
  'valet.unavailable': {
    category: 'valet',
    title: 'No valet available',
    body: () => "We couldn't find a valet near you right now. You haven't been charged.",
    link: job,
  },
  'valet.cancelled': {
    category: 'valet',
    title: 'Valet request cancelled',
    body: () => 'Your valet request was cancelled.',
    link: job,
  },
  'valet.return_requested': {
    category: 'valet',
    title: 'Car return requested',
    body: () => 'The driver wants the car back. Open the job to continue.',
    link: () => '/(valet)/active',
  },
  'valet.no_show': {
    category: 'jobs',
    title: 'Driver no-show',
    body: () => "The driver didn't show up. You've been paid the call-out fee.",
    link: () => '/(valet)/earnings',
  },
  'valet.new_job': {
    category: 'jobs',
    title: 'New valet job',
    body: (d) => {
      const m = num(d.distanceM);
      const e = num(d.earningsPaise);
      const away = m === undefined ? 'nearby' : `${(m / 1000).toFixed(1)} km away`;
      return e === undefined ? `Pickup ${away}.` : `Pickup ${away}. ${formatRupees(e)} earnings.`;
    },
    link: () => '/(valet)/offers',
  },
  'washer.assigned': {
    category: 'carwash',
    title: 'Car wash accepted',
    body: () => 'A washer accepted your request and is on the way.',
    link: job,
  },
  'washer.complete': {
    category: 'carwash',
    title: 'Car is clean',
    body: () => 'Your car wash is complete. View the before and after photos.',
    link: job,
  },
  'washer.unavailable': {
    category: 'carwash',
    title: 'No washer available',
    body: () => "We couldn't find a washer near you right now. You haven't been charged.",
    link: job,
  },
  'washer.cancelled': {
    category: 'carwash',
    title: 'Car wash cancelled',
    body: () => 'Your car wash request was cancelled.',
    link: job,
  },
  'washer.complete_reminder': {
    category: 'jobs',
    title: 'Finish your wash',
    body: () => 'Add the after photo to complete the job and get paid.',
    link: () => '/(washer)/active',
  },
  'washer.job_cancelled': {
    category: 'jobs',
    title: 'Job cancelled',
    body: () => 'The driver cancelled this car wash.',
    link: () => '/(washer)/offers',
  },
  'washer.new_job': {
    category: 'jobs',
    title: 'Car wash request',
    body: (d) => {
      const e = num(d.earningsPaise);
      const service = str(d.serviceName) ?? 'Car wash';
      return e === undefined
        ? `${service} nearby.`
        : `${service} nearby. ${formatRupees(e)} earnings.`;
    },
    link: () => '/(washer)/offers',
  },
  'space.approved': {
    category: 'spaces',
    title: 'Space approved',
    body: () => 'Your parking space is now live.',
    link: listing,
  },
  'space.changes-requested': {
    category: 'spaces',
    actionable: true,
    title: 'Listing needs changes',
    body: () =>
      'Your listing needs a few changes before it can go live. Open it to see what is missing.',
    link: listing,
  },
  'space.rejected': {
    category: 'spaces',
    actionable: true,
    title: 'Listing not approved',
    body: () => "We couldn't approve your listing. Open it to see why and what you can do next.",
    link: listing,
  },
  'partner.verified': {
    category: 'account',
    title: "You're verified",
    body: () => 'Your documents are approved. You can start accepting jobs now.',
    link: () => '/(shared)/settings',
  },
  'partner.rejected': {
    category: 'account',
    actionable: true,
    title: 'Verification not approved',
    body: () => "We couldn't verify your documents. Open settings to see what to fix.",
    link: () => '/(shared)/settings',
  },
  'payout.failed': {
    category: 'payouts',
    actionable: true,
    title: "Payout couldn't go through",
    body: (d) => {
      const n = num(d.netPaise);
      return `We couldn't send ${n === undefined ? 'your payout' : formatRupees(n)} to your account. Check your bank details and we'll retry.`;
    },
    link: payouts,
  },
  'payout.bank_details_updated': {
    category: 'payouts',
    title: 'Bank details updated',
    body: (d) =>
      `Payouts now go to the account ending ${str(d.last4) ?? 'on file'}.` +
      (d.held === true ? ' The first one waits 48 hours, in case this was not you.' : '') +
      " If this wasn't you, contact support now.",
    link: payouts,
  },
  'payout.bank_changed': {
    category: 'payouts',
    title: 'Unsent payouts cancelled',
    body: () =>
      'Because your bank details changed, payouts that were not yet sent were cancelled and stay in your balance.',
    link: payouts,
  },
  'payout.route_activated': {
    category: 'payouts',
    title: 'Payouts are active',
    body: () => 'Your account is verified. Your earnings will be paid out weekly.',
    link: payouts,
  },
  'payout.route_needs_clarification': {
    category: 'payouts',
    actionable: true,
    title: 'More details needed for payouts',
    body: () => 'Our payment partner needs more information before it can pay you.',
    link: payouts,
  },
  'payout.route_rejected': {
    category: 'payouts',
    actionable: true,
    title: 'Payout account not approved',
    body: () =>
      "Our payment partner couldn't approve your account. Check your details and try again.",
    link: payouts,
  },
  'payout.route_suspended': {
    category: 'payouts',
    actionable: true,
    title: 'Payouts paused',
    body: () => 'Your payout account was suspended. Contact support to resume payouts.',
    link: payouts,
  },
  'promo.commission_waiver_granted': {
    category: 'account',
    title: 'Commission-free until your window ends',
    body: (d) =>
      str(d.endsOn) === undefined
        ? 'You keep your full earnings for the next three months.'
        : `You keep your full earnings until ${String(d.endsOn)}.`,
    link: () => '/(owner)/earnings',
  },
} as const satisfies Record<string, Entry>;

export type NotificationTemplate = keyof typeof NOTIFICATION_CATALOG;

export function isNotificationTemplate(key: string): key is NotificationTemplate {
  return Object.hasOwn(NOTIFICATION_CATALOG, key);
}

export interface RenderedNotification {
  readonly category: NotificationCategory;
  readonly actionable: boolean;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string | null;
}

export function renderNotification(
  template: NotificationTemplate,
  data: Data,
): RenderedNotification {
  const entry: Entry = NOTIFICATION_CATALOG[template];
  return {
    category: entry.category,
    actionable: 'actionable' in entry,
    title: entry.title,
    body: entry.body(data),
    deepLink: entry.link(data),
  };
}

export interface EventNotification {
  readonly userId: string;
  readonly template: NotificationTemplate;
  readonly data: Record<string, unknown>;
}

const asId = (v: unknown): string | undefined => str(v);

/**
 * Domain events that also tell a person something. The relay turns each into a
 * `notification.dispatch` job; an event whose recipient is missing maps to null and is dropped
 * visibly by the caller, not silently here.
 */
export const EVENT_NOTIFICATIONS: Readonly<Record<string, (p: Data) => EventNotification | null>> =
  {
    'booking.confirmed': (p) => to(p.driverId, 'booking.confirmed', { bookingId: p.bookingId }),
    'booking.cancelled': (p) => to(p.driverId, 'booking.cancelled', { bookingId: p.bookingId }),
    'booking.completed': (p) => to(p.driverId, 'review.request', { bookingId: p.bookingId }),
    'space.approved': (p) => to(p.ownerId, 'space.approved', { spaceId: p.spaceId }),
    'space.rejected': (p) => to(p.ownerId, 'space.rejected', { spaceId: p.spaceId }),
    'space.changes-requested': (p) =>
      to(p.ownerId, 'space.changes-requested', { spaceId: p.spaceId }),
    'partner.verified': (p) => to(p.userId, 'partner.verified', {}),
    'partner.rejected': (p) => to(p.userId, 'partner.rejected', {}),
  };

function to(
  userId: unknown,
  template: NotificationTemplate,
  data: Record<string, unknown>,
): EventNotification | null {
  const id = asId(userId);
  return id === undefined ? null : { userId: id, template, data };
}
