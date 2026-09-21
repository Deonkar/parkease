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
import {
  cancelValetSchema,
  type DriverValetJob,
  requestValetReturnSchema,
  requestValetSchema,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';

import { CancelJobCommand } from '../../domains/valet/commands/cancel-job.command.js';
import { RequestReturnCommand } from '../../domains/valet/commands/request-return.command.js';
import { RequestValetCommand } from '../../domains/valet/commands/request-valet.command.js';
import { LocationService } from '../../domains/valet/location.service.js';
import { ValetTrackingPublisher } from '../../domains/valet/tracking.publisher.js';
import { ValetService } from '../../domains/valet/valet.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';
import { ContactChannelService } from '../../platform/telephony/masked-call.provider.js';

import { toDriverValetJobView } from './views/valet-job.view.js';

/**
 * The driver's half of valet. §11.10.
 *
 * Two role folders, one domain: this and `roles/valet/jobs.controller.ts` both
 * reach the same commands and the same state machine, with different
 * authorisation and different response shapes (ADR-016). Ownership is resolved
 * per resource and a miss is 404, never 403 (R-SEC-04, R-API-08).
 *
 * Rate limits come from `platform/ratelimit/policies.ts`; idempotency from the
 * global interceptor in AppModule. Neither is declared here — a second
 * `@UseInterceptors(IdempotencyInterceptor)` runs it twice and every mutation
 * then answers 409 (learnings.md).
 */
@Controller('driver/valet')
@Roles(Role.DRIVER)
export class DriverValetController {
  constructor(
    private readonly requestValet: RequestValetCommand,
    private readonly requestReturn: RequestReturnCommand,
    private readonly cancelJob: CancelJobCommand,
    private readonly valet: ValetService,
    private readonly location: LocationService,
    private readonly tracking: ValetTrackingPublisher,
    private readonly contact: ContactChannelService,
  ) {}

  @Post('requests')
  async request(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<DriverValetJob> {
    const input = requestValetSchema.parse(body);

    const { job, offeredTo } = await this.requestValet.execute({
      driverId: user.id,
      bookingId: input.bookingId,
      pickup: input.pickup,
    });

    return this.view(job, offeredTo, null);
  }

  @Get('requests/:id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverValetJob> {
    const job = await this.valet.findOwnedByDriver(id, user.id);
    if (job === undefined) throw new NotFoundException();

    const [offeredTo, lastKnown] = await Promise.all([
      this.valet.countOffers(job.id),
      this.location.lastKnown(job.id),
    ]);

    return this.view(job, offeredTo, lastKnown);
  }

  @Post('requests/:id/return')
  @HttpCode(HttpStatus.OK)
  async return(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DriverValetJob> {
    const input = requestValetReturnSchema.parse(body);

    const job = await this.requestReturn.execute({
      jobId: id,
      driverId: user.id,
      dropLocation: input.dropLocation,
    });

    this.tracking.publishStatus(job.id, job.status);
    return this.view(job, await this.valet.countOffers(job.id), null);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DriverValetJob> {
    const input = cancelValetSchema.parse(body ?? {});

    const job = await this.cancelJob.execute({
      jobId: id,
      driverId: user.id,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });

    this.tracking.publishStatus(job.id, job.status);
    return this.view(job, await this.valet.countOffers(job.id), null);
  }

  private async view(
    job: Awaited<ReturnType<ValetService['findById']>> & object,
    offeredTo: number,
    lastKnownLocation: Awaited<ReturnType<LocationService['lastKnown']>>,
  ): Promise<DriverValetJob> {
    const valet =
      job.assignedUserId === null ? null : await this.valet.valetCard(job.assignedUserId);

    // No assignee, no second party to reach — so no channel, rather than a
    // support thread about a job nobody is on yet.
    const contact =
      job.assignedUserId === null
        ? null
        : await this.contact.forValetJob({
            jobId: job.id,
            fromUserId: job.driverUserId,
            toUserId: job.assignedUserId,
          });

    return toDriverValetJobView({ job, offeredTo, valet, lastKnownLocation, contact });
  }
}
