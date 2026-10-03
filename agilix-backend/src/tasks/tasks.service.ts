import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from './schemas/task.schema';
import { Sprint, SprintDocument, SprintStatus } from '../sprints/schemas/sprint.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UserRole } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { deleteTaskAndTime } from './task-cleanup';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

// Sprint tasks move forward one step at a time, never skipping or going back.
const SPRINT_STATUS_FLOW: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
];

// Sign-off: only these roles may move a sprint task from Review to Done.
const CAN_MARK_DONE: UserRole[] = [UserRole.TESTER, UserRole.MANAGER, UserRole.ADMIN];

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'To Do',
  [TaskStatus.IN_PROGRESS]: 'In Progress',
  [TaskStatus.REVIEW]: 'Review',
  [TaskStatus.DONE]: 'Done',
};

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Sprint.name) private sprintModel: Model<SprintDocument>,
    private readonly notifications: NotificationsService,
  ) {}
  create(dto: CreateTaskDto) {
    return new this.taskModel(dto).save();
  }

  findAllForProject(projectId: string) {
    return this.taskModel.find({ project: projectId }).populate('assignee', 'name email').exec();
  }

  // Backlog = tasks not yet pulled into a sprint
  findBacklog(projectId: string) {
    return this.taskModel
      .find({ project: projectId, sprint: null })
      .populate('assignee', 'name email')
      .exec();
  }

  findForSprint(sprintId: string) {
    return this.taskModel.find({ sprint: sprintId }).populate('assignee', 'name email').exec();
  }

  /**
   * `role` and `userId` are left out by internal callers (the AI services), which
   * skip the sign-off and "only the assignee" checks.
   */
  async update(id: string, dto: UpdateTaskDto, role?: UserRole, userId?: string) {
    const { reviewComment, ...fields } = dto;

    let sentBack: { assignee: string | null; title: string; project: string } | null = null;
    if (dto.status !== undefined) {
      sentBack = await this.checkStatusFlow(id, dto.status, reviewComment, role, userId);
    }

    // Keep the dates the Scrum reports need: when it became Done, and when it
    // joined its sprint.
    const changes: Record<string, unknown> = { ...fields };
    if (dto.status !== undefined) {
      changes.completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
      // The tester's note stays while the developer fixes the task, and is
      // cleared once the work is back in Review or Done.
      if (dto.status === TaskStatus.REVIEW || dto.status === TaskStatus.DONE) {
        changes.reviewNote = null;
      }
    }
    if (sentBack) {
      changes.reviewNote = {
        text: (reviewComment ?? '').trim(),
        by: userId ?? '',
        byName: await this.nameOf(userId),
        at: new Date(),
      };
    }
    if (dto.sprint !== undefined) {
      changes.addedToSprintAt = dto.sprint ? new Date() : null;
    }

    const task = await this.taskModel.findByIdAndUpdate(id, changes, { new: true });
    if (!task) throw new NotFoundException('Task not found');

    // A finished task needs no timer: stop any that are still running so the
    // hours stop counting the moment the task becomes Done.
    if (dto.status === TaskStatus.DONE) await this.stopRunningTimers(id);

    // Tell the person who put the task into Review what has to be fixed.
    if (sentBack?.assignee) {
      const name = await this.nameOf(userId);
      await this.notifications.notify([sentBack.assignee], {
        kind: 'review_returned',
        text: `${name} sent “${sentBack.title}” back to In Progress`,
        detail: `${(reviewComment ?? '').trim()}`,
        link: `/projects/${sentBack.project}/sprints?task=${id}`,
      });
    }
    return task;
  }

  private async nameOf(userId?: string): Promise<string> {
    if (!userId) return 'A tester';
    const person = (await this.taskModel.db
      .model('User')
      .findById(userId)
      .select('name')
      .lean()
      .exec()) as { name?: string } | null;
    return person?.name ?? 'A tester';
  }

  /** Deletes a task and the time logged on it. Managers and admins only (the controller checks). */
  async remove(id: string) {
    if (!OBJECT_ID_PATTERN.test(id)) throw new BadRequestException('Invalid task id');
    const deleted = await deleteTaskAndTime(this.taskModel.db, id);
    if (!deleted) throw new NotFoundException('Task not found');
    return { deleted: true };
  }

  private async stopRunningTimers(taskId: string) {
    const TimeEntry = this.taskModel.db.model('TimeEntry');
    const running: any[] = await TimeEntry.find({ task: taskId, endTime: null });
    const now = new Date();
    await Promise.all(
      running.map((entry) => {
        entry.endTime = now;
        entry.durationSeconds = Math.round((now.getTime() - new Date(entry.startTime).getTime()) / 1000);
        return entry.save();
      }),
    );
  }

  /**
   * Tasks inside a sprint (Scrum) move To Do → In Progress → Review → Done, one
   * step at a time. The only step back is Review → In Progress, by a tester,
   * manager or admin, with a comment. Tasks without a sprint (backlog and
   * Kanban tasks) are not affected, so the Kanban board works as before.
   */
  private async checkStatusFlow(
    id: string,
    status: TaskStatus,
    reviewComment: string | undefined,
    role?: UserRole,
    userId?: string,
  ): Promise<{ assignee: string | null; title: string; project: string } | null> {
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid task id');
    }

    const current = await this.taskModel.findById(id).select('status sprint assignee title project');
    if (!current) throw new NotFoundException('Task not found');
    if (!current.sprint || current.status === status) return null;

    // The one step backwards: a tester (or manager or admin) finds a problem in
    // Review and sends the task back to In Progress, with a comment for the assignee.
    if (current.status === TaskStatus.REVIEW && status === TaskStatus.IN_PROGRESS) {
      if (role && !CAN_MARK_DONE.includes(role)) {
        throw new ForbiddenException(
          'Only a tester, manager or admin can send a task back from Review.',
        );
      }
      if (!reviewComment || !reviewComment.trim()) {
        throw new BadRequestException(
          'Please add a comment that tells the developer what needs to be fixed.',
        );
      }
      return {
        assignee: current.assignee ? String(current.assignee) : null,
        title: current.title,
        project: String(current.project),
      };
    }

    const from = SPRINT_STATUS_FLOW.indexOf(current.status);
    const next = SPRINT_STATUS_FLOW[from + 1];

    if (!next) {
      throw new BadRequestException('This task is already Done.');
    }
    if (status !== next) {
      throw new BadRequestException(
        `Sprint tasks move one step at a time: ${STATUS_LABELS[current.status]} → ${STATUS_LABELS[next]}.`,
      );
    }
    if (status === TaskStatus.DONE) {
      if (role && !CAN_MARK_DONE.includes(role)) {
        throw new ForbiddenException('A task can only be marked Done by a tester, manager or admin. Please ask a tester to review it.');
      }
      return null;
    }

    // To Do → In Progress → Review is the assignee's own work: nobody else moves it,
    // not even a manager or an admin.
    if (userId) {
      if (!current.assignee) {
        throw new ForbiddenException('This task has no assignee yet. Assign it to someone before moving it.');
      }
      if (String(current.assignee) !== userId) {
        throw new ForbiddenException('Only the person this task is assigned to can move it to In Progress or Review.');
      }
    }
    return null;
  }

  // Pull a backlog task into a sprint (Manager selects tasks for sprint).
  // Only planned or active sprints of the same project can receive tasks.
  async assignToSprint(taskId: string, sprintId: string) {
    if (!OBJECT_ID_PATTERN.test(taskId) || !OBJECT_ID_PATTERN.test(sprintId)) {
      throw new BadRequestException('Invalid task or sprint id');
    }

    const [task, sprint] = await Promise.all([
      this.taskModel.findById(taskId).select('project'),
      this.sprintModel.findById(sprintId).select('project status'),
    ]);
    if (!task) throw new NotFoundException('Task not found');
    if (!sprint) throw new NotFoundException('Sprint not found');

    if (String(task.project) !== String(sprint.project)) {
      throw new BadRequestException('This sprint belongs to a different project');
    }
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException(
        'This sprint is already completed. Choose a planned or active sprint.',
      );
    }

    return this.update(taskId, { sprint: sprintId } as UpdateTaskDto);
  }

  /**
   * Raw counts used by both the analytics dashboard (burndown/velocity charts)
   * and the AI sprint-risk prediction endpoint. Kept as pure data here —
   * no prediction logic lives in this service, that's in ai.service.ts.
   */
  async getSprintStats(sprintId: string) {
    const tasks = await this.taskModel.find({ sprint: sprintId }).exec();
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const todo = tasks.filter((t) => t.status === TaskStatus.TODO).length;
    const review = tasks.filter((t) => t.status === TaskStatus.REVIEW).length;
    const totalStoryPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const completedStoryPoints = tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    return { total, done, inProgress, review, todo, totalStoryPoints, completedStoryPoints };
  }
}