import { describe, expect, it } from 'vitest';

import { canAcceptWork, verificationStateFor } from '../verification';

describe('verificationStateFor', () => {
  it('maps the four known statuses', () => {
    expect(verificationStateFor('verified')).toBe('verified');
    expect(verificationStateFor('pending')).toBe('pending');
    expect(verificationStateFor('unverified')).toBe('unverified');
    expect(verificationStateFor('rejected')).toBe('rejected');
  });

  it('fails CLOSED on anything it does not recognise', () => {
    // A status added server-side must not be guessed as "probably fine": that
    // is how an unapproved person ends up washing somebody's car.
    expect(verificationStateFor('provisional')).toBe('unknown');
    expect(verificationStateFor('')).toBe('unknown');
  });
});

describe('canAcceptWork', () => {
  it('is true for verified and false for everything else, including unknown', () => {
    expect(canAcceptWork('verified')).toBe(true);
    for (const status of ['pending', 'unverified', 'rejected', 'provisional', '']) {
      expect(canAcceptWork(status)).toBe(false);
    }
  });
});
