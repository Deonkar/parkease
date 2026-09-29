/**
 * The line under "Owed to you". Route pays each booking's share as the driver pays (ADR-030),
 * so the balance is usually zero, positive only while a checkout is unpaid, and negative when a
 * driver was refunded after Route had already paid the owner (S-98).
 */
export function owedCaption(owedPaise: number): string {
  if (owedPaise < 0) {
    return 'A driver was refunded after you were paid. ParkEase support will be in touch.';
  }
  if (owedPaise > 0) return 'From bookings the driver has not paid yet.';
  return 'Each booking pays you as the driver pays.';
}
