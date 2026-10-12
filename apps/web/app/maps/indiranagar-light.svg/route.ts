import { streetMapSvg } from '@/lib/map/svg';

/**
 * The light map as a static file, so the home page can load it lazily instead of inlining
 * 23KB of geometry (twice, with the RSC payload) ahead of the hero. Rendered once at build.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(
    streetMapSvg({
      theme: 'light',
      pinScale: 1.45,
      fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif',
    }),
    { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } },
  );
}
