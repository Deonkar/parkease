import { brandMarkImage } from '@/lib/brand-mark-image';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function Icon() {
  return brandMarkImage(180);
}
