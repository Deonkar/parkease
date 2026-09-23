import { describe, expect, it } from 'vitest';

import {
  buildBusinessProfile,
  buildGigProfile,
  describeHours,
  formatTime12,
  stepTime,
  type BusinessDraft,
  type GigDraft,
} from '../registration';

/**
 * The two registration forms, as data (§14.2). Validation goes through the
 * contract's own schemas so the form and the server cannot disagree about what
 * a GSTIN or an HH:mm time is; the few rules the contract leaves to the client
 * (a business shows at least one photo, a gig partner gives a name and an ID
 * image) are added here, and every failure lands on the field it concerns.
 */

const BUSINESS: BusinessDraft = {
  businessName: 'SparkleWash Koramangala',
  gstin: '',
  photoIds: ['spaces/abc'],
  opens: '07:00',
  closes: '20:00',
  services: ['basic_exterior', 'premium_wash'],
};

const GIG: GigDraft = {
  name: 'Raju M.',
  idDocumentId: 'documents/id-1',
  services: ['quick_wipe'],
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

describe('the business form', () => {
  it('builds one registration carrying the photos, the hours and the services', () => {
    const built = buildBusinessProfile(BUSINESS);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.profile.partnerType).toBe('business');
    expect(built.profile.businessName).toBe('SparkleWash Koramangala');
    expect(built.profile.businessPhotoIds).toEqual(['spaces/abc']);
    expect(built.profile.capabilities).toEqual(['basic_exterior', 'premium_wash']);
    expect(built.profile).not.toHaveProperty('gstin');
  });

  // Ruling T10-D3: one range, applied to every day of the week.
  it('applies the one open-close range to all seven days', () => {
    const built = buildBusinessProfile(BUSINESS);

    if (!built.ok) throw new Error('expected a valid draft');
    for (const day of DAYS) {
      expect(built.profile.operatingHours?.[day]).toEqual({ open: '07:00', close: '20:00' });
    }
  });

  it('requires a business name, on the name field', () => {
    const built = buildBusinessProfile({ ...BUSINESS, businessName: '   ' });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.name).toMatch(/business name/i);
  });

  it('treats a blank GSTIN as not given — it is optional', () => {
    expect(buildBusinessProfile({ ...BUSINESS, gstin: '  ' }).ok).toBe(true);
  });

  it('refuses a GSTIN the contract does not accept, and says GSTIN', () => {
    const built = buildBusinessProfile({ ...BUSINESS, gstin: '29AABCS1429B1Z' });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.gstin).toContain('GSTIN');
    expect(Object.keys(built.errors)).toEqual(['gstin']);
  });

  it('accepts a valid GSTIN typed in lower case', () => {
    const built = buildBusinessProfile({ ...BUSINESS, gstin: ' 29aabcs1429b1z3 ' });

    expect(built.ok && built.profile.gstin).toBe('29AABCS1429B1Z3');
  });

  it('requires at least one business photo', () => {
    const built = buildBusinessProfile({ ...BUSINESS, photoIds: [] });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.photos).toMatch(/photo/i);
  });

  it('requires at least one service', () => {
    const built = buildBusinessProfile({ ...BUSINESS, services: [] });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.services).toMatch(/at least one/i);
  });

  it('refuses a closing time that is not after the opening time', () => {
    const built = buildBusinessProfile({ ...BUSINESS, opens: '20:00', closes: '07:00' });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.hours).toMatch(/after/i);
  });

  it('refuses a time that is not HH:mm, through the contract', () => {
    const built = buildBusinessProfile({ ...BUSINESS, opens: '7am' });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.hours).toBeDefined();
  });

  it('reports every failing field at once, not one per submit', () => {
    const built = buildBusinessProfile({
      businessName: '',
      gstin: 'nope',
      photoIds: [],
      opens: '07:00',
      closes: '20:00',
      services: [],
    });

    if (built.ok) throw new Error('expected errors');
    expect(Object.keys(built.errors).sort()).toEqual(['gstin', 'name', 'photos', 'services']);
  });
});

describe('the gig form', () => {
  it('builds a gig registration and the one ID image to send after it', () => {
    const built = buildGigProfile(GIG);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.profile.partnerType).toBe('gig');
    expect(built.profile.businessName).toBe('Raju M.');
    expect(built.profile.capabilities).toEqual(['quick_wipe']);
    expect(built.profile.businessPhotoIds).toEqual([]);
    expect(built.documents).toEqual({ idDocumentId: 'documents/id-1' });
  });

  it('never carries an identity number, whatever the draft holds', () => {
    const built = buildGigProfile({ ...GIG, aadhaarNumber: '1234 5678 9012' } as GigDraft);

    if (!built.ok) throw new Error('expected a valid draft');
    expect(JSON.stringify(built)).not.toContain('1234');
  });

  it('requires a name', () => {
    const built = buildGigProfile({ ...GIG, name: '' });

    if (built.ok) throw new Error('expected errors');
    expect(built.errors.name).toMatch(/name/i);
  });

  it('requires the ID image, on the ID field', () => {
    const built = buildGigProfile({ ...GIG, idDocumentId: null });

    if (built.ok) throw new Error('expected errors');
    expect(built.errors.idDocument).toMatch(/ID/);
  });

  it('requires at least one service', () => {
    const built = buildGigProfile({ ...GIG, services: [] });

    if (built.ok) throw new Error('expected errors');
    expect(built.errors.services).toMatch(/at least one/i);
  });
});

describe('the time stepper', () => {
  it('moves in half hours', () => {
    expect(stepTime('07:00', 1)).toBe('07:30');
    expect(stepTime('07:30', 1)).toBe('08:00');
    expect(stepTime('07:00', -1)).toBe('06:30');
  });

  it('stops at the ends of the day rather than wrapping past midnight', () => {
    expect(stepTime('00:00', -1)).toBe('00:00');
    expect(stepTime('23:30', 1)).toBe('23:30');
  });

  it('reads as a 12-hour clock', () => {
    expect(formatTime12('07:00')).toBe('7:00 AM');
    expect(formatTime12('20:30')).toBe('8:30 PM');
    expect(formatTime12('00:00')).toBe('12:00 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
  });
});

describe('describeHours', () => {
  it('says one range once when every day shares it', () => {
    const same = Object.fromEntries(DAYS.map((d) => [d, { open: '07:00', close: '20:00' }]));

    expect(describeHours(same)).toBe('7:00 AM – 8:00 PM, every day');
  });

  it('does not pretend a per-day map is one range', () => {
    expect(
      describeHours({
        mon: { open: '07:00', close: '20:00' },
        tue: { open: '09:00', close: '18:00' },
      }),
    ).toBe('Varies by day');
  });

  it('says so when no hours were given', () => {
    expect(describeHours(null)).toBe('Not set');
    expect(describeHours({})).toBe('Not set');
  });
});
