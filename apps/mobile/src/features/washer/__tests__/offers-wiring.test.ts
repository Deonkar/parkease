import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the offers screen and the washer layout.
 *
 * The component tests prove `WashOfferCard` and `OnlineRail` are right; they
 * cannot prove the screen uses them right. `learnings.md` records the valet
 * rail passing every unit test while its caller hard-coded `lastFixAt={null}`.
 * These read the callers, because the populated screen needs a live API and a
 * device to reach.
 */
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8');

describe('the washer layout owns presence', () => {
  const layout = read('app', '(washer)', '_layout.tsx');

  it('mounts the presence provider around the tabs, once', () => {
    expect(layout.match(/<WasherPresenceProvider>/g)).toHaveLength(1);
    expect(layout.indexOf('<WasherPresenceProvider>')).toBeLessThan(layout.indexOf('<Tabs'));
  });
});

describe('the offers screen', () => {
  const offers = read('app', '(washer)', 'offers.tsx');

  it('reads presence from the layout rather than starting its own heartbeat', () => {
    expect(offers).toContain('usePresence()');
    expect(offers).not.toContain('useWasherPresence(');
    expect(offers).not.toContain('startPresence(');
  });

  it('hands the rail the real presence failure, not a flattened flag', () => {
    expect(offers).toContain('problem={presence.error}');
  });

  it('gates the list on the active-job query having resolved, not only on its data', () => {
    // `active.data` alone is undefined while pending or errored, which would
    // show offers to a partner who may already be on a job.
    expect(offers).toContain('resolveScreenState(active)');
  });

  it('removes a taken job from the cache so it cannot be pressed again', () => {
    expect(offers).toContain('setQueryData<WashJobOffer[]>(washerKeys.offers');
    expect(offers).toMatch(/case 'WASH_JOB_TAKEN':[\s\S]{0,300}removeOffer\(jobId\)/);
  });

  it('meets a definite refusal with "no longer available", not "try again"', () => {
    expect(offers).toContain('isDefiniteRefusal(error)');
    expect(offers).toContain('no longer available');
  });

  it('polls offers only while online', () => {
    expect(offers).toContain('useWasherOffers(presence.isOnline)');
  });

  it('locks accept from the shared verification rule, not an inline comparison', () => {
    expect(offers).toContain('describeWasherVerification(');
    expect(offers).not.toMatch(/verificationStatus === 'verified'/);
  });

  it('treats an unregistered washer as a next step, not an error', () => {
    expect(offers).toContain('isUnregisteredWasher(profile.error)');
    expect(offers).toContain("router.push('/(washer)/profile')");
  });

  it('shows a lost race inline, announced, and never as an alert', () => {
    expect(offers).toContain('This job was taken by another partner');
    expect(offers).toMatch(/accessibilityLiveRegion="polite"[^>]*testID="offer-taken-notice"/);
    expect(offers).not.toMatch(/Alert\.alert\([^)]*taken/);
  });

  it('lists with FlashList and never reads TanStack isLoading', () => {
    expect(offers).toContain('<FlashList');
    expect(offers).not.toContain('FlatList');
    expect(offers).not.toContain('isLoading');
  });
});
