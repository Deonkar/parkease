import { VALET_ACCEPT_TIMEOUT_JOB, VALET_NO_SHOW_JOB } from '@parkease/contracts/valet';
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

    /**
     * Handlers driven by an outbox message rather than by cron. A booking job is
     * scheduled by the write that justifies it — the expiry commits with the
     * booking insert, the completion with the check-in — so there is no cron
     * entry to find and this list is what tells the orphan check so.
     *
     * Adding a handler without adding it here (or to the schedule) fails this
     * test, which is the point: an unreachable handler is dead code that looks
     * alive.
     */
    const outboxEnqueued = new Set([
      'notification.dispatch',
      'booking.expire-unpaid',
      'booking.complete',
      'booking.remind',
      // Enqueued by RefundService inside the cancellation transaction: ledger
      // first, money second, so the gateway call commits with the rows that
      // justify it.
      'payment.issue-refund',
      // Enqueued by ConfirmPaymentCommand when a capture lands against a booking
      // the expiry job already released.
      'payment.orphan-capture',
      // Task 11. Both are enqueued inside the transaction that justifies them:
      // the accept-timeout with the offer (and re-enqueued by itself on each
      // widened round), the no-show with the `arrive` status change. Named from
      // contracts rather than as literals, so this list cannot drift from the
      // registration in handlers.ts or from the enqueue in the API.
      VALET_ACCEPT_TIMEOUT_JOB,
      VALET_NO_SHOW_JOB,
    ]);
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
