import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the service menu screen, for the reason `offers-wiring.test.ts`
 * gives: the row and the save hook are unit-tested, and the populated screen
 * needs a live API and a device to reach, so these read the caller.
 */
const screen = readFileSync(join(process.cwd(), 'app', '(washer)', 'menu.tsx'), 'utf8');
/** The source without its comments, which are allowed to say why the footnote is gone. */
const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the service menu screen', () => {
  it('folds the server rows through toMenuRows into ServiceRows', () => {
    expect(screen).toContain('useServiceMenu()');
    expect(screen).toMatch(/toMenuRows\(/);
    expect(screen).toContain('<ServiceRow');
  });

  it('saves through the intent-keeping hook, not a bare mutation', () => {
    expect(screen).toContain('useServiceSave()');
    expect(screen).not.toContain('useUpsertService');
  });

  it('chooses its state in the shared place, with a skeleton and a retrying error', () => {
    expect(screen).toContain('resolveScreenState(menu)');
    expect(screen).toContain('<Skeleton');
    expect(screen).toMatch(/<ErrorState[\s\S]{0,300}menu\.refetch\(\)/);
  });

  it('says a failed refresh without hiding the menu (ruling T7-I2)', () => {
    expect(screen).toMatch(
      /menu\.isError[\s\S]{0,300}<RefreshNotice[\s\S]{0,300}menu\.refetch\(\)/,
    );
  });

  // H6: a save no longer remounts its row (which moved TalkBack's focus off
  // Save). The row adopts new server values in place: service-row.test.tsx
  // proves it, and that a toggle still keeps the drafts (T8-I1).
  it('keys a row by its service alone, never by its values', () => {
    expect(screen).toContain('key={row.serviceName}');
    expect(code).not.toContain('rowKey');
  });

  it('renders no fee rate: the 80% footnote is a rate in apps/mobile (R-FE-06)', () => {
    expect(code).not.toMatch(/80\s*%|ParkEase fee|0\.2|0\.8/);
  });

  it('is no longer the placeholder', () => {
    expect(screen).not.toContain('Your menu editor will appear here');
  });
});
