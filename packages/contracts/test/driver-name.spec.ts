import { describe, expect, it } from 'vitest';

import { driverShortNameSchema } from '../src/owner/driver-name.js';

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
