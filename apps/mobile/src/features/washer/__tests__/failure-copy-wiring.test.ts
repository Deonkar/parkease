import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * G1 at the callers: one classifier, and every washer screen's error state
 * takes its words from it. A literal "Check your connection" in a screen is a
 * second classifier that has decided, without looking, that every failure is
 * the network — which tells a partner on an out-of-date build to fix a
 * connection that works.
 */
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8');

const SCREENS: readonly (readonly string[])[] = [
  ['active', 'index.tsx'],
  ['earnings.tsx'],
  ['menu.tsx'],
  ['offers.tsx'],
  ['profile', 'index.tsx'],
];

describe.each(SCREENS.map((path) => [path.join('/'), path] as const))(
  'the washer screen %s',
  (_name, path) => {
    const code = read('app', '(washer)', ...path);

    it('never hard-codes "check your connection" as a failure s body or alert', () => {
      expect(code).not.toMatch(/body="Check your connection/);
      expect(code).not.toMatch(/Alert\.alert\([^)]*Check your connection/);
    });

    it('gives every error state its body from the one classifier', () => {
      const states = code.match(/<ErrorState[\s\S]*?\/>/g) ?? [];
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) expect(state).toMatch(/body=\{loadFailureCopy\(/);
    });
  },
);
