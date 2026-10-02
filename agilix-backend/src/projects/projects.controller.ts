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

  /** Admins only. The admin who creates the project becomes its owner. */
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    requireRole(user, 'Only admins can create projects', UserRole.ADMIN);
    return this.projectsService.create(dto, user.userId);
  }

  /** Admins see every project; everyone else only the projects they belong to. */
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.projectsService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.findOne(id, user);
  }

  /** Admins only: choose who is on the team. */
  @Patch(':id/members/:userId')
  addMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'Only admins can choose team members', UserRole.ADMIN);
    return this.projectsService.addMember(id, userId);
  }

  /** Admins only: take someone off the team (the owner cannot be removed). */
  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, 'Only admins can choose team members', UserRole.ADMIN);
    return this.projectsService.removeMember(id, userId);
  }
}
