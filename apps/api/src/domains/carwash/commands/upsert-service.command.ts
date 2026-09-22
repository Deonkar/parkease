import { Injectable } from '@nestjs/common';
import type { CarwashServiceName } from '@parkease/contracts/enums';

import { CatalogService, type WashServiceRow } from '../catalog.service.js';

export interface UpsertWashServiceInput {
  readonly washerUserId: string;
  readonly serviceName: CarwashServiceName;
  readonly carPricePaise: number;
  readonly bikePricePaise: number;
  readonly durationMinutes: number;
  readonly isActive: boolean;
}

/**
 * One service, both vehicle-type prices, two rows.
 *
 * A thin command over `CatalogService.upsertService`, and deliberately thin:
 * the two-row upsert is a single statement against the menu unique key, so
 * there is no orchestration to do and nothing for this to add beyond being the
 * write path the controller is allowed to call. Inlining the catalog call into
 * the controller would put a write in a place the layer rule says only
 * authorises and delegates.
 */
@Injectable()
export class UpsertWashServiceCommand {
  constructor(private readonly catalog: CatalogService) {}

  async execute(input: UpsertWashServiceInput): Promise<WashServiceRow[]> {
    return this.catalog.upsertService(input);
  }
}
