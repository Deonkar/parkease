import { Module } from '@nestjs/common';

import { SurgeModule } from '../surge/surge.module.js';

import { ApprovalService } from './approval.service.js';
import { CreateSpaceCommand } from './commands/create-space.command.js';
import { DeleteSpaceCommand } from './commands/delete-space.command.js';
import { SetSpacePhotosCommand } from './commands/set-space-photos.command.js';
import { ToggleSpaceCommand } from './commands/toggle-space.command.js';
import { UpdateSpaceCommand } from './commands/update-space.command.js';
import { SpaceOccupancyQuery } from './queries/occupancy.js';
import { SearchCache } from './search-cache.js';
import { SearchService } from './search.service.js';
import { SpaceService } from './space.service.js';

@Module({
  imports: [SurgeModule],
  providers: [
    SpaceService,
    ApprovalService,
    SearchService,
    SearchCache,
    CreateSpaceCommand,
    UpdateSpaceCommand,
    DeleteSpaceCommand,
    SetSpacePhotosCommand,
    ToggleSpaceCommand,
    SpaceOccupancyQuery,
  ],
  exports: [
    SpaceService,
    SearchService,
    CreateSpaceCommand,
    UpdateSpaceCommand,
    DeleteSpaceCommand,
    SetSpacePhotosCommand,
    ToggleSpaceCommand,
    SpaceOccupancyQuery,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SpaceModule {}
