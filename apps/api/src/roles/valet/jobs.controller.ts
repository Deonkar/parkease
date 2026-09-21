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
  advanceValetJobSchema,
  type ValetJobView,
  type ValetOffer,
} from '@parkease/contracts/valet';
import { z } from 'zod';

import { AcceptJobCommand } from '../../domains/valet/commands/accept-job.command.js';
import { AdvanceJobCommand } from '../../domains/valet/commands/advance-job.command.js';
import { ValetTrackingPublisher } from '../../domains/valet/tracking.publisher.js';
import { ValetService } from '../../domains/valet/valet.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toValetJobView, toValetOffer } from './views/valet-job.view.js';

/**
 * Where the valet is at the moment of accepting, so the outbound leg can be
 * priced from a real position rather than from the pickup point.
 *
 * Required, not optional: without it the leg would be priced at zero distance
 * and every valet would be paid the bare call-out fee for a real journey.
 */
const acceptBodySchema = z.object({
  from: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});

@Controller('valet/jobs')
@Roles(Role.VALET)
export class ValetJobsController {
  constructor(
    private readonly valet: ValetService,
    private readonly acceptJob: AcceptJobCommand,
    private readonly advanceJob: AdvanceJobCommand,
    private readonly tracking: ValetTrackingPublisher,
  ) {}

  @Get('offers')
  async offers(@CurrentUser() user: AuthUser): Promise<ValetOffer[]> {
    const rows = await this.valet.findOpenOffersFor(user.id);
    return rows.map(toValetOffer);
  }

  @Get('active')
  async active(@CurrentUser() user: AuthUser): Promise<ValetJobView | null> {
    const job = await this.valet.findActiveForValet(user.id);
    return job === undefined ? null : toValetJobView(job);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ValetJobView> {
    const input = acceptBodySchema.parse(body);

    const job = await this.acceptJob.execute({
      jobId: id,
      valetUserId: user.id,
      from: input.from,
    });

    this.tracking.publishStatus(job.id, job.status);
    return toValetJobView(job);
  }

  /**
   * One lifecycle event. The body names what the valet did, never where the job
   * should land — see `advanceValetJobSchema`.
   */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  async status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ValetJobView> {
    const input = advanceValetJobSchema.parse(body);

    const job = await this.advanceJob.execute({
      jobId: id,
      valetUserId: user.id,
      event: input.event,
      ...(input.proofPhotoId === undefined ? {} : { proofPhotoId: input.proofPhotoId }),
    });

    this.tracking.publishStatus(job.id, job.status);
    return toValetJobView(job);
  }

  /**
   * Attaching the parked-car photo, separately from confirming the park.
   *
   * Two calls rather than one because the upload is the slow, failure-prone half
   * on a phone in a basement car park: a valet who uploads successfully and then
   * loses signal should not have to re-upload to retry the status change.
   */
  @Post(':id/proof')
  @HttpCode(HttpStatus.OK)
  async proof(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ValetJobView> {
    const input = z.object({ proofPhotoId: z.string().min(1).max(255) }).parse(body);

    const job = await this.valet.attachProof(id, user.id, input.proofPhotoId);
    if (job === undefined) throw new NotFoundException();

    return toValetJobView(job);
  }
}
