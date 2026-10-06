import { Module } from '@nestjs/common';

import { CreateReviewCommand } from './commands/create-review.command.js';
import { ModerateReviewCommand } from './commands/moderate-review.command.js';
import { ReportReviewCommand } from './commands/report-review.command.js';
import { RespondToReviewCommand } from './commands/respond-to-review.command.js';
import { ReviewService } from './review.service.js';

/**
 * Reviews and trust (task 17). Three role folders call these — driver, owner, admin — with
 * three authorisation contexts and one piece of business logic (ADR-016).
 */
@Module({
  providers: [
    ReviewService,
    CreateReviewCommand,
    ReportReviewCommand,
    RespondToReviewCommand,
    ModerateReviewCommand,
  ],
  exports: [
    ReviewService,
    CreateReviewCommand,
    ReportReviewCommand,
    RespondToReviewCommand,
    ModerateReviewCommand,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ReviewModule {}
