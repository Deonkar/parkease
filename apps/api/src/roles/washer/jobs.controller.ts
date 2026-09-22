import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  acceptWashJobSchema,
  advanceWashJobSchema,
  attachWashPhotoSchema,
  type WashJobOffer,
  type WashJobView,
} from '@parkease/contracts/washer';

import { CarwashService } from '../../domains/carwash/carwash.service.js';
import { AcceptWashCommand } from '../../domains/carwash/commands/accept-wash.command.js';
import { AdvanceWashCommand } from '../../domains/carwash/commands/advance-wash.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toWashJobOffer, toWashJobView } from './views/wash-job.view.js';

@Controller('washer/jobs')
@Roles(Role.WASHER)
export class WasherJobsController {
  constructor(
    private readonly carwash: CarwashService,
    private readonly acceptWash: AcceptWashCommand,
    private readonly advanceWash: AdvanceWashCommand,
  ) {}

  @Get('offers')
  async offers(@CurrentUser() user: AuthUser): Promise<WashJobOffer[]> {
    const rows = await this.carwash.findOpenOffersFor(user.id);
    return rows.map(toWashJobOffer);
  }

  @Get('active')
  async active(@CurrentUser() user: AuthUser): Promise<WashJobView | null> {
    const job = await this.carwash.findActiveForWasher(user.id);
    return job === undefined ? null : toWashJobView(job);
  }

  /**
   * First accept wins; the losers get a 409 from the conditional UPDATE.
   *
   * The body is empty and is parsed anyway. A wash is priced from the partner's
   * own menu, so there is nothing a client could send that the server would
   * believe — and parsing `{}` is what stops a future field being accepted by
   * accident (R-VAL-01).
   */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WashJobView> {
    acceptWashJobSchema.parse(body ?? {});

    const job = await this.acceptWash.execute({ jobId: id, washerUserId: user.id });
    return toWashJobView(job);
  }

  /**
   * One lifecycle event. The body names what the partner did, never where the
   * job should land — see `advanceWashJobSchema`.
   */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  async status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WashJobView> {
    const input = advanceWashJobSchema.parse(body);

    const job = await this.advanceWash.execute({
      jobId: id,
      washerUserId: user.id,
      event: input.event,
    });

    return toWashJobView(job);
  }

  /**
   * The two photos, attached separately from the transitions they gate.
   *
   * Two routes rather than one with a slot parameter, because they are two
   * different moments in the job and carry two different rate budgets in
   * §13.11 — and because a mistyped slot on one route is a photo silently
   * filed as the wrong half of the evidence.
   *
   * Separate from the status change for the reason valet's proof upload is: the
   * upload is the slow, failure-prone half on a phone outdoors, and a partner
   * who uploads and then loses signal should not have to upload again to retry
   * the transition.
   */
  @Post(':id/before-photo')
  @HttpCode(HttpStatus.OK)
  async beforePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WashJobView> {
    return this.attach(user, id, 'before', body);
  }

  @Post(':id/after-photo')
  @HttpCode(HttpStatus.OK)
  async afterPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WashJobView> {
    return this.attach(user, id, 'after', body);
  }

  private async attach(
    user: AuthUser,
    id: string,
    slot: 'before' | 'after',
    body: unknown,
  ): Promise<WashJobView> {
    const input = attachWashPhotoSchema.parse(body);

    const job = await this.carwash.attachPhoto(id, user.id, slot, input.photoId);
    // Not assigned to this partner → 404, never 403 (R-SEC-04, R-API-08).
    if (job === undefined) throw new NotFoundException();

    return toWashJobView(job);
  }
}
