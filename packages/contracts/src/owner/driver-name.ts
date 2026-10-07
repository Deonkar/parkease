import { z } from 'zod';

/**
 * The only shape of a driver's name an owner ever receives: a first name and, at most, a last
 * initial ("Ravi K."), or "Driver" when none is on file (S-85). Owners learn who is arriving, not a
 * driver's full name. Unicode-aware, so a name in any script fits; a second full word does not.
 */
export const driverShortNameSchema = z
  .string()
  .max(48)
  .regex(/^\S{1,40}(?: \S\.)?$/u, 'a first name and at most a last initial');
