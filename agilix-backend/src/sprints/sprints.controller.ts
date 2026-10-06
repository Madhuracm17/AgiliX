import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { CompleteSprintDto } from './dto/complete-sprint.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

const SPRINT_MESSAGE = 'You do not have permission to manage sprints. Only a manager can create, edit, start or complete sprints.';

@Controller('sprints')
export class SprintsController {
  constructor(
    private readonly sprintsService: SprintsService,
    private readonly access: AccessService,
  ) {}

  @Post()
  async create(@Body() dto: CreateSprintDto, @CurrentUser() user: AuthUser) {
    requireRole(user, SPRINT_MESSAGE, UserRole.MANAGER);
    await this.access.assertProject(user, dto.project);
    return this.sprintsService.create(dto);
  }

  @Get()
  async findAllForProject(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, project);
    return this.sprintsService.findAllForProject(project);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.access.assertSprint(user, id);
    return this.sprintsService.findOne(id);
  }

  /** Edit name, goal or dates (not allowed once completed). */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSprintDto, @CurrentUser() user: AuthUser) {
    requireRole(user, SPRINT_MESSAGE, UserRole.MANAGER);
    await this.access.assertSprint(user, id);
    return this.sprintsService.update(id, dto);
  }

  /** planned → active (only one active sprint per project). */
  @Patch(':id/start')
  async start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    requireRole(user, SPRINT_MESSAGE, UserRole.MANAGER);
    await this.access.assertSprint(user, id);
    return this.sprintsService.start(id);
  }

  /**
   * active → completed. Unfinished tasks go to the planned sprint given in
   * { moveUnfinishedTo }, or back to the backlog when it is left out.
   */
  @Patch(':id/complete')
  async complete(@Param('id') id: string, @Body() dto: CompleteSprintDto, @CurrentUser() user: AuthUser) {
    requireRole(user, SPRINT_MESSAGE, UserRole.MANAGER);
    await this.access.assertSprint(user, id);
    return this.sprintsService.complete(id, dto);
  }
}