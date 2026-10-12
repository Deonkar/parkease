'use client';

import { useState } from 'react';

/** Copies the post URL. The label change is announced, so the result is not only visual. */
export function CopyLinkButton({ url }: { readonly url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-sm btn-ink"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => {
            setCopied(false);
          }, 2000);
        });
      }}
    >
      <span aria-live="polite">{copied ? 'Link copied' : 'Copy link'}</span>
    </button>
  );
}
