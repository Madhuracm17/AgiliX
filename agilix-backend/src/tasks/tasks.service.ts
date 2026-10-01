import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from './schemas/task.schema';
import { Sprint, SprintDocument, SprintStatus } from '../sprints/schemas/sprint.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

// Sprint tasks move forward one step at a time, never skipping or going back.
const SPRINT_STATUS_FLOW: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
];

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

  async update(id: string, dto: UpdateTaskDto) {
    if (dto.status !== undefined) {
      await this.checkStatusFlow(id, dto.status);
    }

    const task = await this.taskModel.findByIdAndUpdate(id, dto, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /**
   * Tasks inside a sprint (Scrum) may only move To Do → In Progress →
   * Review → Done, one step at a time. Tasks without a sprint (backlog and
   * Kanban tasks) are not affected, so the Kanban board works as before.
   */
  private async checkStatusFlow(id: string, status: TaskStatus) {
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid task id');
    }

    const current = await this.taskModel.findById(id).select('status sprint');
    if (!current) throw new NotFoundException('Task not found');
    if (!current.sprint || current.status === status) return;

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