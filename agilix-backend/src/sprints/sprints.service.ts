import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Sprint, SprintDocument, SprintStatus } from './schemas/sprint.schema';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export interface CompleteSprintResult {
  sprint: SprintDocument;
  /** How many unfinished tasks were moved back to the backlog. */
  movedToBacklog: number;
}

@Injectable()
export class SprintsService {
  constructor(
    @InjectModel(Sprint.name) private sprintModel: Model<SprintDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
  ) {}

  create(dto: CreateSprintDto) {
    assertValidDateRange(dto.startDate, dto.endDate);
    return new this.sprintModel({ ...dto, goal: dto.goal?.trim() ?? '' }).save();
  }

  findAllForProject(projectId: string) {
    assertObjectId(projectId, 'project');
    return this.sprintModel.find({ project: projectId }).exec();
  }

  async findOne(id: string) {
    assertObjectId(id, 'sprint id');
    const sprint = await this.sprintModel.findById(id);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  /** Edit name, goal or dates. Completed sprints are read-only. */
  async update(id: string, dto: UpdateSprintDto) {
    const sprint = await this.findOne(id);
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException('A completed sprint can no longer be edited');
    }

    assertValidDateRange(dto.startDate ?? sprint.startDate, dto.endDate ?? sprint.endDate);

    if (dto.name !== undefined) sprint.name = dto.name.trim();
    if (dto.goal !== undefined) sprint.goal = dto.goal.trim();
    if (dto.startDate !== undefined) sprint.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) sprint.endDate = new Date(dto.endDate);

    return sprint.save();
  }

  /** planned → active. Only one active sprint per project. */
  async start(id: string) {
    const sprint = await this.findOne(id);

    if (sprint.status === SprintStatus.ACTIVE) {
      throw new BadRequestException('This sprint is already active');
    }
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException('A completed sprint cannot be started again');
    }

    const alreadyActive = await this.sprintModel.findOne({
      project: sprint.project,
      status: SprintStatus.ACTIVE,
      _id: { $ne: sprint._id },
    });
    if (alreadyActive) {
      throw new ConflictException(
        `"${alreadyActive.name}" is already active. Complete it before starting another sprint.`,
      );
    }

    sprint.status = SprintStatus.ACTIVE;
    sprint.startedAt = new Date();
    return sprint.save();
  }

  /**
   * active → completed. Records the committed/completed story points, then moves
   * every task that is not done back to the backlog so no work is lost.
   */
  async complete(id: string): Promise<CompleteSprintResult> {
    const sprint = await this.findOne(id);

    if (sprint.status === SprintStatus.PLANNED) {
      throw new BadRequestException('Start the sprint before completing it');
    }
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException('This sprint is already completed');
    }

    const tasks = await this.taskModel.find({ sprint: sprint._id }).select('status storyPoints').exec();
    const committed = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const completed = tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    const moved = await this.taskModel
      .updateMany(
        { sprint: sprint._id, status: { $ne: TaskStatus.DONE } },
        { $set: { sprint: null } },
      )
      .exec();

    sprint.status = SprintStatus.COMPLETED;
    sprint.completedAt = new Date();
    sprint.committedStoryPoints = committed;
    sprint.completedStoryPoints = completed;
    await sprint.save();

    return { sprint, movedToBacklog: moved.modifiedCount };
  }
}

function assertObjectId(value: string, label: string): void {
  if (!OBJECT_ID_PATTERN.test(value ?? '')) {
    throw new BadRequestException(`Invalid ${label}`);
  }
}

/** The end date must be on or after the start date. */
function assertValidDateRange(start: string | Date, end: string | Date): void {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new BadRequestException('Invalid sprint dates');
  }
  if (endTime < startTime) {
    throw new BadRequestException('End date must be on or after the start date');
  }
}