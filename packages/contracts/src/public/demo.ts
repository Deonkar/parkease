/**
 * The public demo's sign-in (DEMO_MODE). The API accepts `demo:<phone>` instead of a Firebase
 * ID token, but only for these phones: the dev seed's users and the bootstrap admin the demo
 * is seeded with. Anyone can sign in as them, and nobody can sign in as anyone else.
 */
export const DEMO_ACCOUNTS = [
  { role: 'driver', phone: '+919900000001' },
  { role: 'owner', phone: '+919900000002' },
  { role: 'valet', phone: '+919900000003' },
  { role: 'washer', phone: '+919900000004' },
  { role: 'admin', phone: '+919900000005' },
] as const;

export const DEMO_TOKEN_PREFIX = 'demo:';

export function isDemoPhone(phone: string): boolean {
  return DEMO_ACCOUNTS.some((account) => account.phone === phone);
}
