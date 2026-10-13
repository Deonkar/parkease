import { describe, expect, it } from 'vitest';

import { CARWASH_JOB_EVENT_VALUES } from '../src/enums/carwash-job-event.js';
import { washJobViewSchema } from '../src/washer/index.js';

// S-61: a renamed or misspelled event must fail the parse, not reach a switch's default.
describe('washJobViewSchema.availableEvents', () => {
  const events = washJobViewSchema.shape.availableEvents;

  it('accepts every machine event', () => {
    expect(events.safeParse([...CARWASH_JOB_EVENT_VALUES]).success).toBe(true);
  });

  it('refuses an unknown event', () => {
    expect(events.safeParse(['teleport']).success).toBe(false);
  });
});
