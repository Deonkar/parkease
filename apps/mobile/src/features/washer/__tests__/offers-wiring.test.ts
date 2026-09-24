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

  it('removes a job that can no longer be accepted from the cache, now', () => {
    expect(offers).toContain('setQueryData<WashJobOffer[]>(washerKeys.offers');
    expect(offers).toMatch(/outcome\.removeCard\s*\?\s*removeOffer\(jobId\)/);
  });

  it('takes every accept failure s meaning from the one tested function (G3)', () => {
    expect(offers).toContain('acceptOutcomeFor(error)');
    expect(offers).toMatch(/if \(!outcome\.keepIntent\) intents\.current\.delete\(jobId\)/);
    expect(offers).not.toContain('isDefiniteRefusal');
    expect(offers).not.toContain('apiErrorCodeOf');
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

  it('shows an accept failure inline, and never as an alert', () => {
    expect(offers).toContain('testID="offer-taken-notice"');
    expect(offers).toMatch(/setAcceptNotice\(\{ text: outcome\.notice/);
    expect(offers).not.toMatch(/Alert\.alert\([^)]*(taken|accept)/i);
  });

  it('lists with FlashList and never reads TanStack isLoading', () => {
    expect(offers).toContain('<FlashList');
    expect(offers).not.toContain('FlatList');
    expect(offers).not.toContain('isLoading');
  });
});

/** H5, H7 and J1 at the screen. */
describe('the offers screen, per second and per tap', () => {
  const offers = read('app', '(washer)', 'offers.tsx');

  it('keeps no clock of its own: each card s countdown owns the tick (H5)', () => {
    expect(offers).not.toContain('setInterval');
    expect(offers).not.toMatch(/useState\(\(\) => Date\.now\(\)\)/);
    expect(offers).not.toContain('formatCountdown');
  });

  it('hands every card one stable accept callback and a module-level key (H5)', () => {
    expect(offers).toMatch(/onAccept=\{handleAccept\}/);
    expect(offers).toMatch(/keyExtractor=\{offerKey\}/);
    expect(offers).toMatch(/^const offerKey = /m);
  });

  it('guards Accept with a ref, so a double tap sends one accept (H7)', () => {
    expect(offers).toMatch(/const acceptInFlight = useRef\(false\)/);
    expect(offers).toMatch(/if \(isAccepting\(\)\) return;/);
  });

  it('locks the other cards while one accept is pending, with the reason in words (H7)', () => {
    expect(offers).toMatch(/ANOTHER_ACCEPTING/);
    expect(offers).toMatch(/acceptingId !== null && acceptingId !== item\.jobId/);
  });

  it('says a failed refresh over offers it still shows (J1, ruling T7-I2)', () => {
    expect(offers).toMatch(/offers\.isError[\s\S]{0,300}testID="offers-refresh-notice"/);
    expect(offers).toMatch(/testID="offers-refresh-notice"[\s\S]{0,300}offers\.refetch\(\)/);
  });
});

/**
 * M8: a failed go-online is said on the rail (presence state). The Alert is
 * kept only where it adds something the rail cannot: a button to Settings.
 */
describe('a failed go-online on the offers screen', () => {
  it('raises an Alert only when it can open Settings', () => {
    const offers = readFileSync(join(process.cwd(), 'app', '(washer)', 'offers.tsx'), 'utf8');

    expect(offers).toMatch(
      /if \(started\.ok\) return;[\s\S]{0,400}if \(!copy\.settings\) return;\s*Alert\.alert\(/,
    );
  });
});
