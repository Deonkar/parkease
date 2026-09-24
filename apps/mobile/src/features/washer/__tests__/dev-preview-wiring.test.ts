import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the dev-mock preview (ruling T11-W1), for the reason
 * `offers-wiring.test.ts` gives: the camera, the location and the screens need
 * a device to reach, so these read the callers.
 */
const root = process.cwd();
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

const washerDir = join(root, 'src', 'features', 'washer');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

describe('every fixture path is gated', () => {
  it('every washer module that reads the fixtures also asks the gate', () => {
    const readers = sourceFiles(washerDir).filter(
      (path) =>
        !path.endsWith('dev-fixtures.ts') &&
        /from '[./a-z]*dev-fixtures'/.test(readFileSync(path, 'utf8')),
    );

    expect(readers.length).toBeGreaterThan(0);
    for (const path of readers) {
      expect(readFileSync(path, 'utf8'), relative(root, path)).toMatch(
        /isWasherDevMock\(\)|usesDevCamera\(\)/,
      );
    }
  });

  it('screens reach the fixtures only through the gate, never directly', () => {
    for (const screen of ['offers.tsx', 'earnings.tsx', 'menu.tsx', join('active', 'index.tsx')]) {
      expect(read('app', '(washer)', screen)).not.toContain('dev-fixtures');
    }
  });

  it('the gate reads __DEV__ first, so a release build never asks for the session', () => {
    const gate = read('src', 'features', 'washer', 'dev-mock.ts');
    const devCheck = gate.indexOf('typeof __DEV__');
    const sessionCheck = gate.indexOf('await isDevMockSession()');

    expect(devCheck).toBeGreaterThan(-1);
    expect(sessionCheck).toBeGreaterThan(devCheck);
  });
});

describe('hardware the browser preview has not got', () => {
  it('presence stands in a fixture coordinate and sends no permission prompt under dev mock', () => {
    const hook = read('src', 'features', 'washer', 'hooks', 'useWasherPresence.ts');
    expect(hook).toContain('isWasherDevMock()');
    expect(hook).toContain('DEV_WASHER_FIX');
  });

  it('the active screen opens the stand-in camera without asking for a camera it has not got', () => {
    const screen = read('app', '(washer)', 'active', 'index.tsx');
    const standIn = screen.indexOf('usesDevCamera()');
    const permission = screen.indexOf('requestPermission()');

    expect(standIn).toBeGreaterThan(-1);
    expect(permission).toBeGreaterThan(standIn);
  });

  it('the camera shutter resolves with the placeholder photo in the stand-in', () => {
    const camera = read('src', 'features', 'washer', 'components', 'WashCamera.tsx');
    expect(camera).toContain('usesDevCamera()');
    expect(camera).toContain('DEV_PLACEHOLDER_PHOTO_URI');
  });
});

describe('the shutter has a testID, and Maestro uses it', () => {
  it('WashCamera names its shutter', () => {
    expect(read('src', 'features', 'washer', 'components', 'WashCamera.tsx')).toContain(
      'testID="wash-camera-shutter"',
    );
  });

  it('washer-first-job.yaml taps the shutter by id, never by label', () => {
    const flow = read('.maestro', 'washer-first-job.yaml');
    const byId = flow.match(/- tapOn:\r?\n\s+id: 'wash-camera-shutter'\r?\n/g) ?? [];

    // Once for the before photo, once for the after.
    expect(byId).toHaveLength(2);
    expect(flow).not.toMatch(/rightOf:/);
  });
});

/**
 * K3: the first-job flow checks the money by VALUE. "line-net is visible"
 * passes for ₹0.00 and for a figure the app invented; the flow asserts the
 * seeded request's server-priced take-home, on the offer and on the earnings
 * line, from one declared value.
 */
describe('the first-job flow asserts the earned amount by value', () => {
  const flow = read('.maestro', 'washer-first-job.yaml');

  it('declares the seeded take-home once, as an overridable env value', () => {
    expect(flow).toMatch(/env:\r?\n\s+EXPECTED_NET: '₹\d[\d,]*\.\d{2}'/);
  });

  it('asserts the offer and the earnings line against it', () => {
    expect(flow).toMatch(/id: 'offer-earnings'\r?\n\s+text: '\$\{EXPECTED_NET\}'/);
    expect(flow).toMatch(/id: 'line-net'\r?\n\s+text: '\$\{EXPECTED_NET\}'/);
  });

  it('still says it has not been executed', () => {
    expect(flow).toContain('NOT YET EXECUTED');
    expect(read('.maestro', 'README.md')).toContain('Not yet executed');
  });
});
