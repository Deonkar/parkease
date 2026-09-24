import type { VerificationStatus } from '@parkease/contracts/enums';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { describeWasherVerification } from '../verification-copy';

/**
 * A status the contract cannot produce today — the drift the fail-closed
 * branch exists for. Cast in-process on purpose: it simulates a server that
 * moved ahead of this build.
 */
const drifted = (raw: string) => raw as VerificationStatus;

/**
 * The washer's copy over the shared fail-closed mapping.
 *
 * The mapping itself is tested in `features/shared`; what is tested here is the
 * half that was deliberately duplicated (spec §5.1) — the words. Without this, a
 * later edit could converge the washer banner back onto valet wording and ask a
 * car wash partner for a driving licence they were never required to hold.
 */
describe('describeWasherVerification', () => {
  it('lets a verified washer accept, with no banner', () => {
    expect(describeWasherVerification('verified')).toEqual({ canAccept: true, banner: null });
  });

  it('locks a pending washer and says the documents are being checked', () => {
    const view = describeWasherVerification('pending');

    expect(view.canAccept).toBe(false);
    expect(view.banner?.title).toBe('Verification in progress');
  });

  it('fails closed on a status it does not recognise', () => {
    const view = describeWasherVerification(drifted('some_future_status'));

    expect(view.canAccept).toBe(false);
    // Failing closed is only useful if the washer is told why they are blocked.
    expect(view.banner?.title.trim()).not.toBe('');
  });

  it('fails closed on an empty status', () => {
    expect(describeWasherVerification(drifted('')).canAccept).toBe(false);
  });

  it('asks an unverified washer for ID proof, never a driving licence', () => {
    const body = describeWasherVerification('unverified').banner?.body ?? '';

    expect(body).toContain('ID proof');
    expect(body.toLowerCase()).not.toContain('licence');
    expect(body.toLowerCase()).not.toContain('vehicle details');
  });

  it('points a rejected washer at support, as an error', () => {
    const banner = describeWasherVerification('rejected').banner;

    expect(banner?.tone).toBe('error');
    expect(banner?.action).toBe('Contact support');
  });
});

/** I2 and J2. */
describe('the washer verification types and copy', () => {
  it('takes the contract s VerificationStatus, not a string', () => {
    expectTypeOf(describeWasherVerification).parameter(0).toEqualTypeOf<VerificationStatus>();
  });

  it('asks an unverified partner for the ID photo only, never "photos" (J2)', () => {
    // Only a gig partner can be `unverified`: a business registers with its
    // photos and lands `pending`. So the banner asks for the one ID photo.
    const body = describeWasherVerification('unverified').banner?.body ?? '';

    expect(body).toMatch(/ID/);
    expect(body).not.toMatch(/photos/i);
  });
});
