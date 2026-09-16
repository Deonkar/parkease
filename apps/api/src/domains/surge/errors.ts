import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Same contract as `BookingDomainError`: the filter builds `error.code` from the
 * `error` field, and the message is copy a person reads (R-GEN-06).
 */
abstract class SurgeDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class ZoneOverrideNotFoundError extends SurgeDomainError {
  constructor() {
    super('ZONE_OVERRIDE_NOT_FOUND', 'That zone has no override.', HttpStatus.NOT_FOUND);
  }
}

/**
 * Not an HttpException, deliberately.
 *
 * Migration 0024 seeds the `global` row and nothing deletes it, so its absence
 * is not a request that asked for something impossible — it is this deployment
 * being broken. A request-shaped 4xx would tell an operator to fix their input
 * when the thing to fix is the database, so it reaches the filter unmapped and
 * becomes a 500 with the trace id attached (R-FAIL-01).
 */
export class MissingSurgeConfigError extends Error {
  constructor() {
    super('No global surge config row. Migration 0024 seeds it; this database has lost it.');
    this.name = 'MissingSurgeConfigError';
  }
}
