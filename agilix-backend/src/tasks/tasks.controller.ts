import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Get()
  findAllForProject(@Query('project') project: string) {
    return this.tasksService.findAllForProject(project);
  }

  @Get('backlog')
  findBacklog(@Query('project') project: string) {
    return this.tasksService.findBacklog(project);
  }

  @Get('sprint/:sprintId')
  findForSprint(@Param('sprintId') sprintId: string) {
    return this.tasksService.findForSprint(sprintId);
  }

  @Get('sprint/:sprintId/stats')
  getSprintStats(@Param('sprintId') sprintId: string) {
    return this.tasksService.getSprintStats(sprintId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    // Changing who a task is assigned to or how important it is belongs to managers and admins.
    if (dto.priority !== undefined || dto.assignee !== undefined) {
      requireRole(
        user,
        'You do not have permission to change a task\'s priority or assignee. Please contact a manager or an admin.',
        UserRole.ADMIN,
        UserRole.MANAGER,
      );
    }
    return this.tasksService.update(id, dto, user.role);
  }

  @Patch(':id/sprint/:sprintId')
  assignToSprint(@Param('id') id: string, @Param('sprintId') sprintId: string) {
    return this.tasksService.assignToSprint(id, sprintId);
  }
}
