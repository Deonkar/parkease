import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the active-job screen, for the reason `offers-wiring.test.ts`
 * gives: the parts are unit-tested, and the populated screen needs a live API
 * and a device to reach, so these read the caller.
 */
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8');
const screen = read('app', '(washer)', 'active', 'index.tsx');

describe('the active route', () => {
  it('has no job-id route: GET /washer/jobs/active is the only job there is', () => {
    expect(existsSync(join(process.cwd(), 'app', '(washer)', 'active', '[jobId].tsx'))).toBe(false);
  });
});

describe('the active-job screen', () => {
  it('calls both slot hooks before choosing a state, so an error never loses a photo', () => {
    const firstHook = screen.indexOf("usePhotoSlot(jobId, 'before')");
    const secondHook = screen.indexOf("usePhotoSlot(jobId, 'after')");
    const stateChoice = screen.indexOf('resolveScreenState(active)');

    expect(firstHook).toBeGreaterThan(-1);
    expect(secondHook).toBeGreaterThan(-1);
    expect(stateChoice).toBeGreaterThan(Math.max(firstHook, secondHook));
  });

  it('takes its one action from the server s availableEvents', () => {
    expect(screen).toContain('primaryActionFor(job.availableEvents)');
  });

  it('gates that action on the SERVER view of the pair, never local state (T7-T1)', () => {
    expect(screen).toMatch(/before: job\.beforePhotoId !== null/);
    expect(screen).toMatch(/after: job\.afterPhotoId !== null/);
    expect(screen).toContain('lockReasonFor(');
  });

  it('offers capture and Retake from the shared slot rule', () => {
    expect(screen).toContain('canWriteSlot(');
  });

  it('navigates with an Android geo: URI', () => {
    expect(screen).toContain('Linking.openURL');
    expect(screen).toMatch(/`geo:/);
  });

  it('reads the estimate from the partner s own menu', () => {
    expect(screen).toContain('useServiceMenu()');
  });

  it('keeps one intent per status change across retries (R-FE-05)', () => {
    expect(screen).toContain('newIntent()');
    expect(screen).toMatch(/useRef\(new Map<string, Intent>\(\)\)/);
  });

  it('shows no money it computed: earnings are the server figure, formatted', () => {
    expect(screen).toContain('formatPaise(job.earningsPaise');
  });

  it('points an empty state at the Offers tab', () => {
    expect(screen).toContain("router.navigate('/(washer)/offers')");
  });
});
