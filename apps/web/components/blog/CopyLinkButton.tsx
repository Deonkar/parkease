'use client';

import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const LABEL: Record<CopyState, string> = {
  idle: 'Copy link',
  copied: 'Link copied',
  failed: 'Couldn’t copy',
};

/**
 * Copies the post URL. The label change is announced, so the result is not only visual, and a
 * clipboard that is missing (insecure origin) or refused says so instead of failing silently.
 */
export function CopyLinkButton({ url }: { readonly url: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const reset = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(reset.current);
    },
    [],
  );

  const show = (next: CopyState) => {
    setState(next);
    window.clearTimeout(reset.current);
    reset.current = window.setTimeout(() => {
      setState('idle');
    }, 2000);
  };

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-light"
      onClick={() => {
        // Undefined outside secure contexts, whatever the DOM types claim.
        const clipboard = navigator.clipboard as Clipboard | undefined;
        if (clipboard === undefined) {
          show('failed');
          return;
        }
        clipboard.writeText(url).then(
          () => {
            show('copied');
          },
          () => {
            show('failed');
          },
        );
      }}
    >
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}
