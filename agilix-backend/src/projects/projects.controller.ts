import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** Admins and managers. Whoever creates the project becomes its owner. */
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    requireRole(user, 'You do not have permission to create projects. Please contact an admin or a manager.', UserRole.ADMIN, UserRole.MANAGER);
    return this.projectsService.create(dto, user.userId);
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

  /** Admins and managers: choose who is on the team. */
  @Patch(':id/members/:userId')
  async addMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'You do not have permission to manage team members. Please contact an admin or a manager.', UserRole.ADMIN, UserRole.MANAGER);
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
    return this.projectsService.withPeople(await this.projectsService.removeMember(id, userId));
  }
}
