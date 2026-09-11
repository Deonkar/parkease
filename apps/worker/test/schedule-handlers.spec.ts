import { describe, it, expect, vi } from 'vitest';

import { registerHandlers } from '../src/handlers.js';
import { registerSchedule } from '../src/schedule.js';

describe('worker schedule and handler coverage', () => {
  it('every scheduled job has a handler and vice versa (no orphans)', async () => {
    const handlerNames: string[] = [];
    const scheduleNames: string[] = [];

    const bossMockForHandlers = {
      work: vi.fn(async (name: string) => {
        handlerNames.push(name);
        return name;
      }),
    };

    const bossMockForSchedule = {
      schedule: vi.fn(async (name: string) => {
        scheduleNames.push(name);
      }),
    };

    const deps = {} as never;

    await registerHandlers(bossMockForHandlers as never, deps);
    await registerSchedule(bossMockForSchedule as never);

    const outboxEnqueued = new Set(['notification.dispatch']);
    const scheduledSet = new Set(scheduleNames);

    for (const handler of handlerNames) {
      const covered = scheduledSet.has(handler) || outboxEnqueued.has(handler);
      expect(
        covered,
        `handler '${handler}' has no schedule and is not enqueued by the outbox`,
      ).toBe(true);
    }

    for (const scheduled of scheduleNames) {
      const hasHandler = handlerNames.includes(scheduled);
      expect(hasHandler, `schedule '${scheduled}' has no handler`).toBe(true);
    }
  });

  it('every scheduled job declares tz: Asia/Kolkata', async () => {
    const tzValues: Array<{ name: string; tz: string | undefined }> = [];

    const bossMock = {
      schedule: vi.fn(
        async (name: string, _cron: string, _data: unknown, opts: { tz?: string }) => {
          tzValues.push({ name, tz: opts?.tz });
        },
      ),
    };

    await registerSchedule(bossMock as never);

    for (const entry of tzValues) {
      expect(entry.tz, `job '${entry.name}' must declare tz: 'Asia/Kolkata'`).toBe('Asia/Kolkata');
    }
  });
});
