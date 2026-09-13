import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  createSpaceSchema,
  setSpacePhotosSchema,
  updateSpaceSchema,
} from '@parkease/contracts/owner';

import { CreateSpaceCommand } from '../../domains/space/commands/create-space.command.js';
import { DeleteSpaceCommand } from '../../domains/space/commands/delete-space.command.js';
import { SetSpacePhotosCommand } from '../../domains/space/commands/set-space-photos.command.js';
import { ToggleSpaceCommand } from '../../domains/space/commands/toggle-space.command.js';
import { UpdateSpaceCommand } from '../../domains/space/commands/update-space.command.js';
import { SpaceService } from '../../domains/space/space.service.js';
import { CurrentUser, type AuthUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toSpaceDetail } from './views/space-detail.view.js';
import { toSpaceSummary } from './views/space-summary.view.js';

@Controller('owner/spaces')
@Roles(Role.OWNER)
export class OwnerSpacesController {
  constructor(
    private readonly createSpace: CreateSpaceCommand,
    private readonly updateSpace: UpdateSpaceCommand,
    private readonly deleteSpace: DeleteSpaceCommand,
    private readonly setPhotos: SetSpacePhotosCommand,
    private readonly toggleSpace: ToggleSpaceCommand,
    private readonly spaceService: SpaceService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = createSpaceSchema.parse(body);
    const result = await this.createSpace.execute({ ownerId: user.id, body: parsed });
    const { slots, photos } = await this.spaceService.loadRelated(result.id);
    const [space] = await this.spaceService
      .listByOwner(user.id, { page: 1, limit: 1 })
      .then((r) => r.items.filter((s) => s.id === result.id));
    if (!space) throw new NotFoundException();
    return toSpaceDetail(space, slots, photos);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(50, Math.max(1, Number(limitStr) || 20));

    const result = await this.spaceService.listByOwner(user.id, { page, limit });

    const items = await Promise.all(
      result.items.map(async (space) => {
        const [slots, photos] = await Promise.all([
          this.spaceService.getSlots(space.id),
          this.spaceService.listPhotos(space.id),
        ]);
        const primaryPhoto = photos.find((p) => p.isPrimary) ?? photos[0];
        return toSpaceSummary(space, slots, primaryPhoto);
      }),
    );

    return { items, meta: result.meta };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const space = await this.spaceService.findOwnedBy(id, user.id);
    if (!space) throw new NotFoundException('Space not found.');
    const { slots, photos } = await this.spaceService.loadRelated(id);
    return toSpaceDetail(space, slots, photos);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = updateSpaceSchema.parse(body);
    await this.updateSpace.execute({ ownerId: user.id, spaceId: id, body: parsed });
    const space = await this.spaceService.findOwnedBy(id, user.id);
    if (!space) throw new NotFoundException();
    const { slots, photos } = await this.spaceService.loadRelated(id);
    return toSpaceDetail(space, slots, photos);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.deleteSpace.execute({ ownerId: user.id, spaceId: id });
  }

  @Post(':id/photos')
  async replacePhotos(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = setSpacePhotosSchema.parse(body);
    await this.setPhotos.execute({ ownerId: user.id, spaceId: id, body: parsed });
    const space = await this.spaceService.findOwnedBy(id, user.id);
    if (!space) throw new NotFoundException();
    const { slots, photos } = await this.spaceService.loadRelated(id);
    return toSpaceDetail(space, slots, photos);
  }

  @Patch(':id/toggle')
  async toggle(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.toggleSpace.execute({ ownerId: user.id, spaceId: id });
  }
}
