import { describe, expect, it } from 'vitest';

import {
  LICENCE_WARNING_DAYS,
  describeVerification,
  documentStateFor,
  licenceWarning,
} from '../profile-status';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 22);
const inDays = (days: number) => new Date(NOW + days * DAY_MS).toISOString();

/**
 * The four verification states, and what each one lets a valet do.
 *
 * `user_roles.status` is independent of `valet_profiles.verification_status`
 * (ADR-012), and it is the profile status that gates work. A valet awaiting
 * review can browse offers and cannot accept them — showing them the jobs is
 * the point, because someone who can see ₹200 within reach has a reason to
 * finish their document upload.
 */
describe('describeVerification', () => {
  it('lets a verified valet work, with no banner', () => {
    const view = describeVerification('verified');

    expect(view.canAccept).toBe(true);
    expect(view.banner).toBe(null);
  });

  it('explains a pending review without implying the valet did something wrong', () => {
    const view = describeVerification('pending');

    expect(view.canAccept).toBe(false);
    expect(view.banner?.tone).toBe('info');
    expect(view.banner?.title).toMatch(/verification in progress/i);
  });

  it('tells an unverified valet what to do rather than only what is missing', () => {
    const view = describeVerification('unverified');

    expect(view.canAccept).toBe(false);
    expect(view.banner?.tone).toBe('info');
    // Names the action, not just the deficiency.
    expect(view.banner?.body).toMatch(/upload/i);
  });

  it('names a rejection as a rejection and points at a way forward', () => {
    const view = describeVerification('rejected');

    expect(view.canAccept).toBe(false);
    expect(view.banner?.tone).toBe('error');
    expect(view.banner?.body).toMatch(/support/i);
  });

  it('treats an unrecognised status as not permitted, never as verified', () => {
    // A new status added server-side must fail closed: a client that guesses
    // "probably fine" would let an unapproved valet take someone's car.
    const view = describeVerification('something_new');

    expect(view.canAccept).toBe(false);
    expect(view.banner).not.toBe(null);
  });
});

/**
 * The licence-expiry warning exists because the assignment query filters on
 * `licence_expires_at`: an expired licence silently removes a valet from every
 * candidate set. Telling them in advance is cheaper than fielding "why did my
 * jobs stop".
 */
describe('licenceWarning', () => {
  it('says nothing when the licence is comfortably valid', () => {
    expect(licenceWarning(inDays(400), NOW)).toBe(null);
  });

  it('warns inside the notice window, counting the days left', () => {
    const warning = licenceWarning(inDays(41), NOW);

    expect(warning?.expired).toBe(false);
    expect(warning?.daysLeft).toBe(41);
    expect(warning?.message).toContain('41 days');
  });

  it('warns on the boundary day itself', () => {
    expect(licenceWarning(inDays(LICENCE_WARNING_DAYS), NOW)).not.toBe(null);
  });

  it('stays silent one day outside the window', () => {
    expect(licenceWarning(inDays(LICENCE_WARNING_DAYS + 1), NOW)).toBe(null);
  });

  it('reports an expired licence as expired, not as zero days left', () => {
    const warning = licenceWarning(inDays(-3), NOW);

    expect(warning?.expired).toBe(true);
    // "expires in -3 days" is the kind of thing that ships.
    expect(warning?.message).not.toContain('-3');
    expect(warning?.message).toMatch(/expired/i);
  });

  it('treats the expiry day itself as still valid', () => {
    const warning = licenceWarning(inDays(0), NOW);

    expect(warning?.expired).toBe(false);
    expect(warning?.daysLeft).toBe(0);
  });

  it('says nothing when no licence has been recorded yet', () => {
    expect(licenceWarning(null, NOW)).toBe(null);
  });

  it('says nothing for an unparseable date rather than rendering NaN', () => {
    expect(licenceWarning('not a date', NOW)).toBe(null);
  });
});

/**
 * One owner for the verification rule.
 *
 * The profile screen first derived the licence row from its own inline
 * `verificationStatus === 'verified'` check — a second copy that can drift from
 * the one gating the Accept button on the offers screen.
 */
describe('documentStateFor', () => {
  it('is missing when nothing has been uploaded, whatever the status says', () => {
    expect(documentStateFor('verified', false)).toBe('missing');
    expect(documentStateFor('pending', false)).toBe('missing');
  });

  it('is verified only when the account is verified', () => {
    expect(documentStateFor('verified', true)).toBe('verified');
  });

  it('distinguishes a rejection from a review still in progress', () => {
    expect(documentStateFor('rejected', true)).toBe('failed');
    expect(documentStateFor('pending', true)).toBe('pending');
    expect(documentStateFor('unverified', true)).toBe('pending');
  });

  it('does not report an unknown status as verified', () => {
    expect(documentStateFor('something_new', true)).not.toBe('verified');
  });
});
