import { describe, expect, it } from 'vitest';

import { profileScreenState, registrationNotice } from '../profile-state';

/**
 * The profile screen is the default entry for a washer who has not registered
 * yet, so "not registered" is its FIRST state, not an error: a first-run
 * partner who opens it must see a next step, never "Couldn't load".
 */

const NOT_REGISTERED = {
  response: { status: 404, data: { error: { code: 'WASHER_PROFILE_NOT_FOUND' } } },
};
/** A proxy's 404 carries no domain code, so it stays an error. */
const PROXY_404 = { response: { status: 404, data: '<html>Not Found</html>' } };

const query = (overrides: Partial<Parameters<typeof profileScreenState>[0]>) => ({
  isPending: false,
  isFetching: false,
  isError: false,
  data: undefined,
  error: null,
  ...overrides,
});

describe('profileScreenState', () => {
  it('is the set-up state for a washer the server says is not registered', () => {
    expect(profileScreenState(query({ isError: true, error: NOT_REGISTERED }))).toBe(
      'unregistered',
    );
  });

  it('is an error for any other failure, including a 404 without the domain code', () => {
    expect(profileScreenState(query({ isError: true, error: PROXY_404 }))).toBe('error');
    expect(profileScreenState(query({ isError: true, error: new Error('Network Error') }))).toBe(
      'error',
    );
  });

  it('is loading until the first answer, not set-up', () => {
    expect(profileScreenState(query({ isPending: true, isFetching: true }))).toBe('loading');
  });

  it('keeps a registered profile on screen when a refetch fails (T7-I2)', () => {
    expect(
      profileScreenState(query({ isError: true, error: new Error('x'), data: { a: 1 } })),
    ).toBe('ready');
  });
});

describe('registrationNotice', () => {
  /** Ruling T10-C1: a business registration is complete, so it lands in review. */
  it('tells a business "Submitted for review" straight after registering', () => {
    expect(registrationNotice('registered', 'pending', 'business')).toMatch(
      /^Submitted for review/,
    );
  });

  it('says "Submitted for review" to a gig partner once the server has the ID', () => {
    expect(registrationNotice('registered', 'pending', 'gig')).toMatch(/^Submitted for review/);
  });

  it('never asks a business for an ID photo, whatever the status', () => {
    for (const status of ['pending', 'unverified', 'rejected', 'verified']) {
      for (const kind of ['registered', 'document-not-sent']) {
        expect(registrationNotice(kind, status, 'business') ?? '').not.toMatch(/\bID\b/);
      }
    }
  });

  it('does not claim a review the server has not started', () => {
    const notice = registrationNotice('registered', 'unverified', 'gig') ?? '';

    expect(notice).not.toMatch(/submitted for review/i);
    expect(notice).toMatch(/ID/);
  });

  it('tells a gig partner whose ID did not send that the profile is saved and the ID is not', () => {
    const notice = registrationNotice('document-not-sent', 'unverified', 'gig') ?? '';

    expect(notice).toMatch(/saved/i);
    expect(notice).toMatch(/ID/);
  });

  it('says "Submitted for review" once an ID sent later has put the profile in review', () => {
    expect(registrationNotice('document-not-sent', 'pending', 'gig')).toMatch(
      /^Submitted for review/,
    );
  });

  it('says nothing without a notice to give', () => {
    expect(registrationNotice(undefined, 'pending', 'gig')).toBeNull();
    expect(registrationNotice('something-else', 'pending', 'business')).toBeNull();
  });
});

/** G6: a retry that found an earlier registration with different details. */
describe('registrationNotice for an earlier registration', () => {
  it('says the partner was already registered and asks them to check their details', () => {
    for (const status of ['unverified', 'pending'] as const) {
      for (const type of ['gig', 'business'] as const) {
        const notice = registrationNotice('already-registered', status, type) ?? '';
        expect(notice).toMatch(/already registered/i);
        expect(notice).toMatch(/check your details/i);
      }
    }
  });
});
