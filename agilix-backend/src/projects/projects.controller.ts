import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly access: AccessService,
  ) {}

  /**
   * Admins and managers. Whoever creates the project becomes its owner. An admin
   * can add managers; a manager's choices become team requests.
   */
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    requireRole(user, 'You do not have permission to create projects. Please contact an admin or a manager.', UserRole.ADMIN, UserRole.MANAGER);
    return this.projectsService.create(dto, user);
  }

  /** Admins see every project; everyone else (managers included) only the projects they belong to. */
  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return this.projectsService.withPeople(await this.projectsService.findAll(user));
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.withPeople(await this.projectsService.findOne(id, user));
  }

  /** Admins and managers: rename the project, change its description or its status. */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'You do not have permission to edit projects. Please contact an admin or a manager.', UserRole.ADMIN, UserRole.MANAGER);
    return this.projectsService.withPeople(await this.projectsService.update(id, dto, user));
  }

  /** Admins, or the manager who owns the project. Also deletes its tasks, sprints and time entries. */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    requireRole(user, 'You do not have permission to delete projects. Please contact an admin or the project owner.', UserRole.ADMIN, UserRole.MANAGER);
    return this.projectsService.remove(id, user);
  }

  /** Admins add managers to a team. Managers send team requests instead (see /team-invites). */
  @Patch(':id/members/:userId')
  async addMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'Only an admin can add a manager to a team. Managers send a team request to developers and testers.', UserRole.ADMIN);
    await this.access.assertProject(user, id);
    return this.projectsService.withPeople(await this.projectsService.addMember(id, userId));
  }

  /** Admins and managers: take someone off the team (the owner cannot be removed). */
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'You do not have permission to manage team members. Please contact an admin or a manager.', UserRole.ADMIN, UserRole.MANAGER);
    await this.access.assertProject(user, id);
    return this.projectsService.withPeople(await this.projectsService.removeMember(id, userId, user));
  }
}
