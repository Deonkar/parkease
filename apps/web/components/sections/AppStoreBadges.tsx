import { STORE_LINKS } from '@/lib/site';

/** Store buttons. Until the App Store listing exists the iPhone button says so instead of linking. */
export function AppStoreBadges() {
  return (
    <div className="flex flex-wrap gap-2.5">
      <a className="btn btn-light" href={STORE_LINKS.android}>
        Get it on Android
      </a>
      {STORE_LINKS.ios === null ? (
        <span className="btn btn-disabled" aria-disabled="true">
          iPhone app coming soon
        </span>
      ) : (
        <a className="btn btn-outline-light" href={STORE_LINKS.ios}>
          Download for iPhone
        </a>
      )}
    </div>
  );
}
