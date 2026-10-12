/**
 * Where a real photo goes in an app screen: the owner's listing photo, a wash partner's before
 * and after. Drawn as the app's own empty photo state, not as a fake picture.
 */
export function PhotoTile({
  label,
  className = '',
}: {
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-midnight-raised to-floor text-[13px] font-bold text-on-midnight-muted ${className}`}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
      {label}
    </div>
  );
}
