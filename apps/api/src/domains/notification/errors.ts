import { HttpException, HttpStatus } from '@nestjs/common';

/** `error` is the code, `message` is user copy — the same contract as the other domain errors. */
export class NotificationNotFoundError extends HttpException {
  constructor() {
    super(
      { error: 'NOTIFICATION_NOT_FOUND', message: 'That notification does not exist.' },
      HttpStatus.NOT_FOUND,
    );
  }
}
