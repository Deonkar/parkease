import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUSH_ENABLED,
  EVENT_NOTIFICATIONS,
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATEGORIES,
  type NotificationTemplate,
  renderNotification,
} from '../src/shared/index.js';

const APP = join(__dirname, '../../../apps/mobile/app');
const SAMPLE = { bookingId: 'b1', spaceId: 's1', jobId: 'j1' };
const TEMPLATES = Object.keys(NOTIFICATION_CATALOG) as NotificationTemplate[];

/** Walks `app/` the way Expo Router does: a literal segment, else a `[param]` one. */
function routeExists(link: string): boolean {
  let dir = APP;
  const segs = link.split('/').filter(Boolean);
  for (const [i, seg] of segs.entries()) {
    const last = i === segs.length - 1;
    const names = readdirSync(dir);
    const hit = names.find((n) => n === seg) ?? names.find((n) => /^\[.+\]/.test(n));
    if (last) {
      const file = names.find((n) => n === `${seg}.tsx` || /^\[.+\]\.tsx$/.test(n));
      if (file !== undefined) return true;
      return hit !== undefined && existsSync(join(dir, hit, 'index.tsx'));
    }
    if (hit === undefined) return false;
    dir = join(dir, hit);
  }
  return false;
}

describe('notification catalog', () => {
  it('promotions are off by default and every other category is on', () => {
    expect(DEFAULT_PUSH_ENABLED.promotions).toBe(false);
    for (const c of NOTIFICATION_CATEGORIES.filter((x) => x !== 'promotions')) {
      expect(DEFAULT_PUSH_ENABLED[c]).toBe(true);
    }
  });

  it.each(TEMPLATES)('%s renders with no data, without printing "undefined"', (t) => {
    const r = renderNotification(t, {});
    expect(NOTIFICATION_CATEGORIES).toContain(r.category);
    expect(`${r.title} ${r.body}`).not.toMatch(/undefined|NaN|\{/);
  });

  it('carries no emoji in any copy', () => {
    for (const t of TEMPLATES) {
      const r = renderNotification(t, { earningsPaise: 12_000, distanceM: 1500, last4: '1234' });
      expect(`${r.title}${r.body}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it.each(TEMPLATES)('%s deep link resolves to a real mobile route', (t) => {
    const { deepLink } = renderNotification(t, SAMPLE);
    if (deepLink !== null) expect(routeExists(deepLink), deepLink).toBe(true);
  });

  it('formats paise as rupees', () => {
    expect(
      renderNotification('valet.new_job', { distanceM: 2500, earningsPaise: 320_000 }).body,
    ).toBe('Pickup 2.5 km away. ₹3,200 earnings.');
  });

  it('every event mapping targets a template in the catalog', () => {
    for (const [event, map] of Object.entries(EVENT_NOTIFICATIONS)) {
      const out = map({ driverId: 'u', ownerId: 'u', userId: 'u', bookingId: 'b', spaceId: 's' });
      expect(out, event).not.toBeNull();
      expect(TEMPLATES).toContain(out?.template);
    }
  });

  it('an event with no recipient maps to null', () => {
    expect(EVENT_NOTIFICATIONS['booking.confirmed']?.({ bookingId: 'b' })).toBeNull();
  });
});
