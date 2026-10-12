import { webColors } from '@parkease/tokens';

/**
 * The "P" mark as a next/og element, shared by the favicon, the Apple touch icon and the logo
 * the Organization JSON-LD points at. Inline styles only, because next/og has no stylesheet.
 */
export function BrandMark({ size, font }: { readonly size: number; readonly font?: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: webColors.primary,
        color: webColors.onPrimary,
        borderRadius: size * 0.2,
        boxShadow: `inset 0 0 0 ${String(Math.max(1, Math.round(size * 0.055)))}px ${webColors.onPrimary}`,
        fontFamily: font,
        fontWeight: 900,
        fontSize: size * 0.72,
        lineHeight: 1,
      }}
    >
      P
    </div>
  );
}
