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

  it('tells a refused status change through the one tested function (G2)', () => {
    expect(screen).toContain('advanceOutcomeFor(error)');
    expect(screen).toMatch(/if \(!outcome\.keepIntent\) intents\.current\.delete\(key\)/);
    expect(screen).toMatch(/setActionNotice\(outcome\.notice\)/);
    expect(screen).toMatch(/actionNotice === null[\s\S]{0,200}testID="active-action-notice"/);
  });
});

/** H7: a double tap on the primary action sends one status change. */
describe('the active primary action', () => {
  it('is guarded by a ref, not only by the mutation s pending flag', () => {
    expect(screen).toMatch(/const advancing = useRef\(false\)/);
    expect(screen).toMatch(/if \(action === null \|\| isAdvancing\(\)\) return;/);
  });

  it('no longer claims every error invalidates the job', () => {
    expect(screen).not.toMatch(/invalidates the job on every error/);
  });
});

/** K2: the arithmetic ban `earnings-wiring.test.ts` holds, held here too (R-FE-06). */
describe('the active screen s money', () => {
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('does no arithmetic on a Paise value, and sums nothing', () => {
    expect(code).not.toMatch(/Paise\s*[-+*/]|[-+*/]\s*[\w.]*Paise\b/);
    expect(code).not.toMatch(/reduce\(/);
  });
});

/**
 * M12: getting to the car. While the job is on its "On the way" step, Navigate
 * is a real, labelled 48dp action next to the primary action, not a 44dp icon
 * in the header.
 */
describe('navigating to the car', () => {
  const source = readFileSync(
    join(process.cwd(), 'app', '(washer)', 'active', 'index.tsx'),
    'utf8',
  );

  it('is offered on the "On the way" step, beside the primary action', () => {
    expect(source).toMatch(/gettingThere = currentStepFor\(job\.status\) === 0/);
    expect(source).toMatch(
      /\{gettingThere \? \([\s\S]{0,600}testID="active-navigate"[\s\S]{0,900}<WashActionBar/,
    );
  });

  it('says what it does in words, at the touch target', () => {
    expect(source).toMatch(/testID="active-navigate"[\s\S]{0,700}Navigate to the car/);
    expect(source).toMatch(/navigate: \{[^}]*minHeight: touchTarget/);
  });
});
