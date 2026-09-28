import { APPROVAL_STATUS_VALUES } from '@parkease/contracts/enums';
import { describe, expect, it } from 'vitest';

import { APPROVAL_STATUS_DISPLAY } from '../approval-status';

describe('APPROVAL_STATUS_DISPLAY', () => {
  it('has an entry for every APPROVAL_STATUS_VALUES member, so a new status cannot fall through', () => {
    for (const status of APPROVAL_STATUS_VALUES) {
      const entry = APPROVAL_STATUS_DISPLAY[status];
      expect(entry, `missing entry for status "${status}"`).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
    }
  });

  it('does not carry a Unicode glyph standing in for an icon', () => {
    for (const entry of Object.values(APPROVAL_STATUS_DISPLAY)) {
      // Icon names are MaterialCommunityIcons keys: ascii, hyphenated.
      expect(entry.icon).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
