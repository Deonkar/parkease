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

  it('says a failed refresh without hiding the job (ruling T7-I2)', () => {
    expect(screen).toMatch(/active\.isError[\s\S]{0,400}testID="active-refresh-notice"/);
    expect(screen).toMatch(/testID="active-refresh-notice"[\s\S]{0,600}active\.refetch\(\)/);
  });

  it('passes the slot s writability into its state, so a closed slot shows the server photo', () => {
    expect(screen).toMatch(/slotStateFor\(attached\[slot\], capture, \{ writable/);
  });

  it('never drops a camera-permission failure on the floor (R-FAIL-01)', () => {
    expect(screen).toMatch(/openCamera[\s\S]{0,1500}catch \(error\)[\s\S]{0,200}warn\(/);
    expect(screen).not.toContain('void openCamera(');
  });
});
