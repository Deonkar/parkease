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
  cancelCarwashSchema,
  type DriverWashJob,
  driverWashJobSchema,
  requestCarwashSchema,
  type WashPaymentOrder,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';
import { computeWashFee } from '@parkease/contracts/money';
import { toPaise, toRate } from '@parkease/contracts/primitives';
import { nextCarwashStatus, parseCarwashJobStatus } from '@parkease/contracts/washer';

import { CarwashService, type WashJobRow } from '../../domains/carwash/carwash.service.js';
import { CancelWashCommand } from '../../domains/carwash/commands/cancel-wash.command.js';
import { CreateWashOrderCommand } from '../../domains/carwash/commands/create-wash-order.command.js';
import { RequestCarwashCommand } from '../../domains/carwash/commands/request-carwash.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * The driver's side of a car wash. Two role folders, one domain (ADR-016).
 *
 * This composes its own view rather than importing one from `roles/washer/` —
 * nothing imports across role folders, and ESLint refuses it. The two views are
 * genuinely different anyway: a partner sees their earnings, a driver sees what
 * they are charged.
 */
@Controller('driver/carwash')
@Roles(Role.DRIVER)
export class DriverCarwashController {
  constructor(
    private readonly carwash: CarwashService,
    private readonly requestCarwash: RequestCarwashCommand,
    private readonly cancelWash: CancelWashCommand,
    private readonly createOrder: CreateWashOrderCommand,
  ) {}

  /**
   * §13.5. Refused unless the booking is `active` — the car must be physically
   * parked before anyone is dispatched to wash it.
   */
  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  async request(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<DriverWashJob> {
    const input = requestCarwashSchema.parse(body);

    const { job, offeredTo } = await this.requestCarwash.execute({
      driverId: user.id,
      bookingId: input.bookingId,
      serviceName: input.serviceName,
      vehicleType: input.vehicleType,
    });

    return this.toView(job, offeredTo);
  }

  @Get('requests/:id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverWashJob> {
    const job = await this.carwash.findOwnedByDriver(id, user.id);
    // 404 for somebody else's wash, never 403 (R-SEC-04, R-API-08).
    if (job === undefined) throw new NotFoundException();

    return this.toView(job, await this.carwash.countOffers(job.id));
  }

  /**
   * The Checkout handoff. §13.4, and the one route beyond §13.11's table.
   *
   * Minting lives here rather than inside the partner's accept because three
   * partners race for one job: two lose the conditional UPDATE, and each would
   * have already created a Razorpay order that no webhook will ever join to a
   * local row. The driver mints one, for the partner who actually won, at that
   * partner's own price.
   */
  @Post('requests/:id/order')
  @HttpCode(HttpStatus.CREATED)
  async order(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WashPaymentOrder> {
    return this.createOrder.execute({ washJobId: id, driverId: user.id });
  }

  /**
   * §13.9. Free before `washing`; refused from it, because the partner has
   * travelled with their equipment and started.
   */
  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DriverWashJob> {
    const input = cancelCarwashSchema.parse(body ?? {});

    const job = await this.cancelWash.execute({
      jobId: id,
      driverId: user.id,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });

    return this.toView(job, await this.carwash.countOffers(job.id));
  }

  private async toView(job: WashJobRow, offeredTo: number): Promise<DriverWashJob> {
    const washer =
      job.washerUserId === null ? null : await this.carwash.washerCard(job.washerUserId);

    /**
     * Money is null until somebody accepts, and that is not a formatting
     * choice. The amount comes from the winning partner's own menu, so before
     * the race resolves there is no number — and a screen rendering ₹0 in that
     * window is telling the driver something untrue.
     */
    const fee =
      job.pricePaise === null
        ? null
        : computeWashFee(toPaise(job.pricePaise), toRate(Number(job.commissionRate)));

    return driverWashJobSchema.parse({
      id: job.id,
      bookingId: job.bookingId,
      status: job.status,
      serviceName: job.serviceName,
      vehicleType: job.vehicleType,
      pricePaise: fee?.pricePaise ?? null,
      gstPaise: fee?.gstPaise ?? null,
      driverTotalPaise: fee?.driverTotalPaise ?? null,
      offeredTo,
      offerRadiusM: job.offerRadiusM,
      offerRound: job.offerRound,
      washer,
      beforePhotoId: job.beforePhotoId,
      afterPhotoId: job.afterPhotoId,
      // Server-decided, so the app never renders a button the machine will
      // refuse. The same table the command asserts against.
      cancellable: nextCarwashStatus(parseCarwashJobStatus(job.status), 'cancel') !== null,
      cancellationReason: job.cancellationReason,
      requestedAt: job.createdAt.toISOString(),
      acceptedAt: job.acceptedAt?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    });
  }
}
