import { brandMarkImage } from '@/lib/brand-mark-image';

/** /logo.png, the square logo referenced by the Organization JSON-LD. Rendered once at build. */
export const dynamic = 'force-static';

export function GET() {
  return brandMarkImage(512);
}
