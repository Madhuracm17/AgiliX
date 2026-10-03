import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service';
import { StartTimerDto } from './dto/start-timer.dto';
import { StopTimerDto } from './dto/stop-timer.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

@Controller('time-entries')
export class TimeEntriesController {
  constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly access: AccessService,
  ) {}

  /** Starts the logged-in user's timer on an open task that is assigned to them. */
  @Post('start')
  async start(@Body() dto: StartTimerDto, @CurrentUser() user: AuthUser) {
    const { projectId, status, assignee, inSprint } = await this.access.assertTask(user, dto.task);
    // Only the person the task is assigned to can time it (not even a manager).
    if (!assignee) {
      throw new ForbiddenException('This task has no assignee yet, so its timer cannot be started.');
    }
    if (assignee !== user.userId) {
      throw new ForbiddenException('Only the person this task is assigned to can start its timer.');
    }
    // A finished task needs no timer. (Its running timers were stopped when it became Done.)
    if (status === 'done') {
      throw new BadRequestException('This task is already Done, so its timer cannot be started.');
    }
    // On a sprint board, work that has not been started yet (To Do) is not timed.
    if (inSprint && status === 'todo') {
      throw new BadRequestException('Move this task to In Progress before starting its timer.');
    }
    return this.timeEntriesService.start(dto.task, projectId, user.userId);
  }

  /** Only the person who started a timer can stop it. */
  @Patch(':id/stop')
  stop(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: StopTimerDto,
  ) {
    return this.timeEntriesService.stop(id, user.userId, dto?.endedAt);
  }

  // These values change every time the timer runs, so the browser must
  // never cache them — otherwise a refresh can show a stale total.
  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId')
  async findForTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertTask(user, taskId);
    return this.timeEntriesService.findForTask(taskId);
  }

  /** The logged-in user's own running timer on this task (if any). */
  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId/active')
  async findActiveForTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertTask(user, taskId);
    return this.timeEntriesService.findActiveForTask(taskId, user.userId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId/total')
  async getTaskTotal(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertTask(user, taskId);
    return this.timeEntriesService.getTaskTotal(taskId);
  }

  /** Everyone's time on a project: managers and admins. */
  @Header('Cache-Control', 'no-store')
  @Get('project/:projectId')
  async findForProject(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(
      user,
      'You do not have permission to view everyone\'s time. Please contact a manager.',
      UserRole.MANAGER,
      UserRole.ADMIN,
    );
    await this.access.assertProject(user, projectId);
    return this.timeEntriesService.findForProject(projectId);
  }
}
