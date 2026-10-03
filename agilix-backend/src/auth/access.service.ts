import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId } from 'mongoose';
import { UserRole } from '../users/schemas/user.schema';
import { AuthUser } from './jwt-config';

/** The two fields that decide who may see a project. */
export interface ProjectAccess {
  _id?: unknown;
  owner?: unknown;
  members?: unknown[];
}

/** True when the user owns the project or is on its member list. */
export function belongsTo(project: ProjectAccess, userId: string): boolean {
  // Ids are compared as text because older records may store them as strings.
  if (project.owner != null && String(project.owner) === userId) return true;
  return (project.members ?? []).some((m) => String(m) === userId);
}

const NO_ACCESS_MESSAGE =
  'You do not have access to this project. Please ask an admin to add you to the team.';

/**
 * Answers "may this person touch this project?" for every route that takes a
 * project, sprint or task id. Admins can reach every project; everyone else
 * only the projects they own or are a member of.
 *
 * It only reads (projects, sprints, tasks) and throws a friendly error when the
 * answer is no: 400 for a badly formed id, 404 when it does not exist, 403 when
 * the person is not on the team. The AI and MCP code does not use it.
 */
@Injectable()
export class AccessService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Checks the project id, that it exists, and that the person may use it. */
  async assertProject(user: AuthUser, projectId: string): Promise<void> {
    if (!isValidObjectId(projectId)) throw new BadRequestException('Invalid project id');
    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('owner members')
      .lean()
      .exec()) as ProjectAccess | null;
    if (!project) throw new NotFoundException('Project not found');
    if (user.role === UserRole.ADMIN) return;
    if (!belongsTo(project, user.userId)) throw new ForbiddenException(NO_ACCESS_MESSAGE);
  }

  /** Same check, starting from a sprint. Returns the sprint's project id. */
  async assertSprint(user: AuthUser, sprintId: string): Promise<string> {
    if (!isValidObjectId(sprintId)) throw new BadRequestException('Invalid sprint id');
    const sprint = (await this.connection
      .model('Sprint')
      .findById(sprintId)
      .select('project')
      .lean()
      .exec()) as { project?: unknown } | null;
    if (!sprint) throw new NotFoundException('Sprint not found');
    const projectId = String(sprint.project);
    await this.assertProject(user, projectId);
    return projectId;
  }

  /** Same check, starting from a task. Returns the task's project, assignee and status. */
  async assertTask(
    user: AuthUser,
    taskId: string,
  ): Promise<{ projectId: string; assignee: string | null; status: string }> {
    if (!isValidObjectId(taskId)) throw new BadRequestException('Invalid task id');
    const task = (await this.connection
      .model('Task')
      .findById(taskId)
      .select('project assignee status')
      .lean()
      .exec()) as { project?: unknown; assignee?: unknown; status?: string } | null;
    if (!task) throw new NotFoundException('Task not found');
    const projectId = String(task.project);
    await this.assertProject(user, projectId);
    return {
      projectId,
      assignee: task.assignee ? String(task.assignee) : null,
      status: String(task.status ?? ''),
    };
  }

  /**
   * A task may only be given to someone who exists and is on the project's team
   * (the owner counts). Used when a task is created or its assignee changes.
   */
  async assertAssignee(projectId: string, assigneeId: string): Promise<void> {
    if (!isValidObjectId(assigneeId)) throw new BadRequestException('Invalid assignee id');
    const [person, project] = await Promise.all([
      this.connection.model('User').exists({ _id: assigneeId }),
      this.connection
        .model('Project')
        .findById(projectId)
        .select('owner members')
        .lean()
        .exec() as Promise<ProjectAccess | null>,
    ]);
    if (!person) throw new NotFoundException('That person does not exist');
    if (!project) throw new NotFoundException('Project not found');
    if (!belongsTo(project, assigneeId)) {
      throw new BadRequestException(
        'That person is not on this project\'s team. Add them to the team first.',
      );
    }
  }
}
