import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  upsertWashServiceSchema,
  type WashServiceMenu,
  washServiceMenuSchema,
  washServiceNameParamSchema,
} from '@parkease/contracts/washer';

import { CatalogService, type WashServiceRow } from '../../domains/carwash/catalog.service.js';
import { UpsertWashServiceCommand } from '../../domains/carwash/commands/upsert-service.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('washer/services')
@Roles(Role.WASHER)
export class WasherServicesController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly upsert: UpsertWashServiceCommand,
  ) {}

  /** Ten rows: five services, two vehicle types each. */
  @Get()
  async menu(@CurrentUser() user: AuthUser): Promise<WashServiceMenu> {
    return toMenu(await this.catalog.menuFor(user.id));
  }

  /**
   * One service, both vehicle-type prices, two rows upserted together.
   *
   * The service name is the path parameter and is parsed against the closed v1
   * catalogue, so a partner cannot edit one service by naming another and
   * cannot invent a sixth.
   */
  @Put(':serviceName')
  async update(
    @CurrentUser() user: AuthUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<WashServiceMenu> {
    const { serviceName } = washServiceNameParamSchema.parse(params);
    const input = upsertWashServiceSchema.parse(body);

    await this.upsert.execute({
      washerUserId: user.id,
      serviceName,
      carPricePaise: input.carPricePaise,
      bikePricePaise: input.bikePricePaise,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive,
    });

    // The whole menu rather than the two rows that changed: the app renders one
    // list, and returning a fragment would make it merge state by hand.
    return toMenu(await this.catalog.menuFor(user.id));
  }
}

const toMenu = (rows: readonly WashServiceRow[]): WashServiceMenu =>
  washServiceMenuSchema.parse({
    services: rows.map((row) => ({
      serviceName: row.serviceName,
      vehicleType: row.vehicleType,
      pricePaise: row.pricePaise,
      durationMinutes: row.durationMinutes,
      isActive: row.isActive,
    })),
  });
