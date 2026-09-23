import { describe, expect, it } from 'vitest';

import { describeWasherVerification } from '../verification-copy';

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
    const view = describeWasherVerification('some_future_status');

    expect(view.canAccept).toBe(false);
    // Failing closed is only useful if the washer is told why they are blocked.
    expect(view.banner?.title.trim()).not.toBe('');
  });

  it('fails closed on an empty status', () => {
    expect(describeWasherVerification('').canAccept).toBe(false);
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
