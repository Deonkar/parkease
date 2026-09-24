import { useCallback, useMemo, useRef, useState } from 'react';

import { defaultUploadDeps, uploadImage, type UploadFolder } from '@/lib/uploads';

export interface HeldUpload {
  readonly key: string;
  /** The local image — kept through a failure, so Retry needs no second photograph. */
  readonly uri: string;
  /** Set once the file is stored; what the registration call sends. */
  readonly uploadId: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
}

export interface HeldUploads {
  readonly items: readonly HeldUpload[];
  /** The stored ids, in the order the photos were taken. */
  readonly uploadIds: readonly string[];
  /** Any photo still on its way — the form holds its submit while this is true. */
  readonly busy: boolean;
  /** A new photograph. When the field holds one (`max` 1), it replaces the old one. */
  readonly add: (uri: string) => Promise<void>;
  /** The held photograph again. A photo that already has an id is not re-sent. */
  readonly retry: (key: string) => Promise<void>;
  readonly remove: (key: string) => void;
}

/**
 * Photos for a form: capture → upload, with the image held on failure.
 *
 * `usePhotoSlot`'s promise, without its attach step (spec §6.2): a photo that
 * failed to upload stays on screen with the §6 copy, and Retry sends THAT photo
 * again. The upload id is held once it exists, so a failed registration retried
 * sends the same ids — the same body under the same intent (R-FE-05).
 *
 * No intent lives here. `uploadImage` signs every attempt with a fresh key
 * (ADR-029): an upload has no side effect to deduplicate, and a replayed
 * signature goes stale. The intent belongs to the call that USES the ids.
 */
export function useHeldUploads(folder: UploadFolder, max: number): HeldUploads {
  const [items, setItems] = useState<readonly HeldUpload[]>([]);
  // What is held right now, read after an await: a photo removed or replaced
  // while it was on the network must not reappear when its answer lands.
  const held = useRef<readonly HeldUpload[]>([]);
  const nextKey = useRef(0);

  const commit = useCallback((next: readonly HeldUpload[]) => {
    held.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<HeldUpload>) => {
      commit(held.current.map((item) => (item.key === key ? { ...item, ...change } : item)));
    },
    [commit],
  );

  const send = useCallback(
    async (key: string, uri: string) => {
      patch(key, { uploading: true, error: null });
      const result = await uploadImage(uri, folder, defaultUploadDeps());
      if (!held.current.some((item) => item.key === key)) return;
      // `uploadImage` has already logged a failure at warn (R-FAIL-01).
      patch(
        key,
        result.ok
          ? { uploading: false, uploadId: result.uploadId }
          : { uploading: false, error: result.message },
      );
    },
    [folder, patch],
  );

  const add = useCallback(
    async (uri: string) => {
      nextKey.current += 1;
      const key = String(nextKey.current);
      const fresh: HeldUpload = { key, uri, uploadId: null, uploading: false, error: null };
      const kept = max === 1 ? [] : held.current;
      if (kept.length >= max) return;
      commit([...kept, fresh]);
      await send(key, uri);
    },
    [commit, max, send],
  );

  const retry = useCallback(
    async (key: string) => {
      const item = held.current.find((candidate) => candidate.key === key);
      if (item === undefined || item.uploadId !== null || item.uploading) return;
      await send(key, item.uri);
    },
    [send],
  );

  const remove = useCallback(
    (key: string) => {
      commit(held.current.filter((item) => item.key !== key));
    },
    [commit],
  );

  return useMemo(
    () => ({
      items,
      uploadIds: items.flatMap((item) => (item.uploadId === null ? [] : [item.uploadId])),
      busy: items.some((item) => item.uploading),
      add,
      retry,
      remove,
    }),
    [items, add, retry, remove],
  );
}
