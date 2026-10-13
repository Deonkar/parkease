import { describe, expect, it } from 'vitest';

import { driverShortNameSchema } from '../src/owner/driver-name.js';
import { partnerDisplayNameSchema } from '../src/washer/profile.js';

/** S-85: an owner never receives a driver's full name, whatever produces the response. */
describe('driverShortNameSchema', () => {
  it.each(['Ravi K.', 'Ravi', 'Driver', 'Anne-Marie D.', 'राज क.'])('accepts %s', (name) => {
    expect(driverShortNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['Ravi Kumar', 'Ravi Kumar Sharma', 'Ravi K. Sharma', '', ' Ravi K.', 'Ravi K'])(
    'refuses %j',
    (name) => {
      expect(driverShortNameSchema.safeParse(name).success).toBe(false);
    },
  );
});

describe('partnerDisplayNameSchema (S-60)', () => {
  it.each(['SparkleWash', 'Raju M.', 'Shine & Go Car Care'])('accepts %s', (name) => {
    expect(partnerDisplayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    'ParkEase Support',
    'Park Ease Wash',
    'parkease',
    'Customer Care Wash',
    'Admin',
    'Official Washers',
  ])('refuses %j, an impersonation made before anyone reviews it', (name) => {
    expect(partnerDisplayNameSchema.safeParse(name).success).toBe(false);
  });
});
