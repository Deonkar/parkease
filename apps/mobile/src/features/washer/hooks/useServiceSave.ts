import type { CarwashServiceName } from '@parkease/contracts/enums';
import type { UpsertWashService } from '@parkease/contracts/washer';
import { useCallback, useRef, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';

import { apiErrorCodeOf, isDefiniteRefusal } from '../api/errors';

import { useUpsertService } from './useWasherQueries';

export interface ServiceSave {
  /** Saves one row. Never rejects: a failure is kept for `failureFor`. */
  readonly save: (serviceName: CarwashServiceName, input: UpsertWashService) => Promise<void>;
  readonly isSaving: (serviceName: CarwashServiceName) => boolean;
  /** Why the last save of this row failed, or null. */
  readonly failureFor: (serviceName: CarwashServiceName) => string | null;
}

const OFFLINE = "Couldn't save. Check your connection and try again.";
const REFUSED = "Couldn't save this service. Check the prices and try again.";

interface HeldIntent {
  readonly intent: Intent;
  readonly input: UpsertWashService;
}

const sameInput = (a: UpsertWashService, b: UpsertWashService) =>
  a.carPricePaise === b.carPricePaise &&
  a.bikePricePaise === b.bikePricePaise &&
  a.durationMinutes === b.durationMinutes &&
  a.isActive === b.isActive;

/**
 * The menu screen's saves, one row at a time (spec §6.3, R-FE-05).
 *
 * One intent per save the partner starts, replayed when THAT save is retried
 * after a transport failure — the first attempt may have landed, and the replay
 * is how the server answers it once. A save with different values is a
 * different request: the idempotency interceptor refuses a reused key with a
 * different body (422), so it gets a new key. After a success or a definite
 * refusal the server has answered for good, and the key is dropped.
 *
 * `mutateAsync`, not `mutate`: two rows can be in flight at once, and TanStack
 * fires per-call `mutate` callbacks only for the latest call, which would lose
 * the first row's answer.
 */
export function useServiceSave(): ServiceSave {
  const { mutateAsync } = useUpsertService();
  const intents = useRef(new Map<CarwashServiceName, HeldIntent>());
  const [saving, setSaving] = useState<ReadonlySet<CarwashServiceName>>(() => new Set());
  const [failures, setFailures] = useState<Partial<Record<CarwashServiceName, string | null>>>({});

  const save = useCallback(
    async (serviceName: CarwashServiceName, input: UpsertWashService) => {
      const held = intents.current.get(serviceName);
      const intent = held !== undefined && sameInput(held.input, input) ? held.intent : newIntent();
      intents.current.set(serviceName, { intent, input });

      setSaving((current) => new Set(current).add(serviceName));
      setFailures((current) => ({ ...current, [serviceName]: null }));
      try {
        // The response replaces the whole cached menu (`useUpsertService`).
        await mutateAsync({ serviceName, input, intent });
        intents.current.delete(serviceName);
      } catch (error) {
        const refused = isDefiniteRefusal(error);
        if (refused) intents.current.delete(serviceName);
        warn(
          refused
            ? `washer.menu: saving ${serviceName} was refused (${apiErrorCodeOf(error) ?? 'no code'})`
            : `washer.menu: saving ${serviceName} did not reach the server`,
          error,
        );
        setFailures((current) => ({ ...current, [serviceName]: refused ? REFUSED : OFFLINE }));
      } finally {
        setSaving((current) => {
          const next = new Set(current);
          next.delete(serviceName);
          return next;
        });
      }
    },
    [mutateAsync],
  );

  const isSaving = useCallback(
    (serviceName: CarwashServiceName) => saving.has(serviceName),
    [saving],
  );
  const failureFor = useCallback(
    (serviceName: CarwashServiceName) => failures[serviceName] ?? null,
    [failures],
  );

  return { save, isSaving, failureFor };
}
