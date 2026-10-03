import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';
import { ApprovalsService } from '../approvals/approvals.service';

const SPRINT_ADD_MESSAGE =
  'This task is assigned to someone else, so only they or a manager can add it to a sprint.';
const SPRINT_REMOVE_MESSAGE =
  'This task is assigned to someone else, so only they can take it out of a sprint. You can only move tasks that are unassigned or assigned to you.';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, dto.project);

    // Admins and managers can assign a task to any team member. Developers and
    // testers can create tasks for themselves (or leave them unassigned).
    const canAssignOthers = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    if (dto.assignee && !canAssignOthers && dto.assignee !== user.userId) {
      throw new ForbiddenException(
        'You do not have permission to assign tasks to other people. Please contact a manager or an admin.',
      );
    }
    if (dto.assignee) await this.access.assertAssignee(dto.project, dto.assignee);

    // Developers and testers need a manager's approval to add a task. The task
    // is created when the manager approves it (see ApprovalsService).
    if (!canAssignOthers) return this.approvals.requestCreate(user, dto);

    return this.tasksService.create(dto);
  }

  /**
   * Managers and admins delete a task straight away. A developer or tester sends
   * a request instead, and the task is deleted when a manager approves it.
   */
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { projectId } = await this.access.assertTask(user, id);
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return this.tasksService.remove(id);
    }
    return this.approvals.requestDelete(user, id, projectId);
  }

  @Get()
  async findAllForProject(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, project);
    return this.tasksService.findAllForProject(project);
  }

  @Get('backlog')
  async findBacklog(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, project);
    return this.tasksService.findBacklog(project);
  }

  @Get('sprint/:sprintId')
  async findForSprint(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertSprint(user, sprintId);
    return this.tasksService.findForSprint(sprintId);
  }

  @Get('sprint/:sprintId/stats')
  async getSprintStats(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertSprint(user, sprintId);
    return this.tasksService.getSprintStats(sprintId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    const { projectId, assignee } = await this.access.assertTask(user, id);

    // Changing who a task is assigned to or how important it is belongs to managers and admins.
    if (dto.priority !== undefined || dto.assignee !== undefined) {
      requireRole(
        user,
        'You do not have permission to change a task\'s priority or assignee. Please contact a manager or an admin.',
        UserRole.ADMIN,
        UserRole.MANAGER,
      );
    }
    if (dto.assignee) await this.access.assertAssignee(projectId, dto.assignee);

    // Putting a task into a sprint has its own route, which also checks the sprint.
    if (dto.sprint) {
      throw new BadRequestException('Use "Add to sprint" to put a task into a sprint.');
    }
    // Taking a task out of its sprint: only if it is unassigned or assigned to you,
    // so nobody (a manager included) can pull someone else's task back out.
    if (dto.sprint === null) this.requireOwnTask(user, assignee, SPRINT_REMOVE_MESSAGE);

    return this.tasksService.update(id, dto, user.role, user.userId);
  }

  /**
   * Adding a task to a sprint. Managers and admins plan sprints, so they can add
   * any task, for any assignee (this is how a manager gives someone work).
   * Developers and testers can only add tasks that are unassigned or their own.
   */
  @Patch(':id/sprint/:sprintId')
  async assignToSprint(
    @Param('id') id: string,
    @Param('sprintId') sprintId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { assignee } = await this.access.assertTask(user, id);
    await this.access.assertSprint(user, sprintId);
    const isPlanner = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    if (!isPlanner) this.requireOwnTask(user, assignee, SPRINT_ADD_MESSAGE);
    return this.tasksService.assignToSprint(id, sprintId);
  }

  private requireOwnTask(user: AuthUser, assignee: string | null, message: string): void {
    if (assignee && assignee !== user.userId) throw new ForbiddenException(message);
  }
}
