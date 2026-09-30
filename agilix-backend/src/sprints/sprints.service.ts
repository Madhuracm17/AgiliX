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
import { CompleteSprintDto } from './dto/complete-sprint.dto';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export interface CompleteSprintResult {
  sprint: SprintDocument;
  /** How many unfinished tasks were moved. */
  movedCount: number;
  /** The sprint they were moved to, or null when they went back to the backlog. */
  movedToSprint: { _id: string; name: string } | null;
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
   * every task that is not done either to a chosen planned sprint or back to the
   * backlog, so no work is lost.
   */
  async complete(id: string, dto: CompleteSprintDto = {}): Promise<CompleteSprintResult> {
    const sprint = await this.findOne(id);

    if (sprint.status === SprintStatus.PLANNED) {
      throw new BadRequestException('Start the sprint before completing it');
    }
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException('This sprint is already completed');
    }

    // Check the destination BEFORE changing anything.
    let target: SprintDocument | null = null;
    if (dto.moveUnfinishedTo) {
      if (String(dto.moveUnfinishedTo) === String(sprint._id)) {
        throw new BadRequestException('Choose a different sprint for the unfinished tasks');
      }
      target = await this.sprintModel.findById(dto.moveUnfinishedTo);
      if (!target) {
        throw new NotFoundException('The sprint chosen for the unfinished tasks was not found');
      }
      if (String(target.project) !== String(sprint.project)) {
        throw new BadRequestException('That sprint belongs to a different project');
      }
      if (target.status !== SprintStatus.PLANNED) {
        throw new BadRequestException('Unfinished tasks can only be moved to a planned sprint');
      }
    }

    // Task.sprint is stored as TEXT by the existing schema (and could be an ObjectId in
    // future), so match both forms. The raw MongoDB collection is used on purpose so
    // Mongoose does not convert the values and miss the stored ones.
    const sprintIdText = String(sprint._id);
    const inThisSprint = { sprint: { $in: [sprint._id, sprintIdText] } };
    const tasks = this.taskModel.collection;

    const sprintTasks = await tasks
      .find(inThisSprint, { projection: { status: 1, storyPoints: 1 } })
      .toArray();
    const committed = sprintTasks.reduce((sum, t) => sum + (Number(t.storyPoints) || 0), 0);
    const completed = sprintTasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (Number(t.storyPoints) || 0), 0);

    // Stored as text, the same way the rest of the app saves the sprint link.
    const moved = await tasks.updateMany(
      { ...inThisSprint, status: { $ne: TaskStatus.DONE } },
      { $set: { sprint: target ? String(target._id) : null, updatedAt: new Date() } },
    );

    sprint.status = SprintStatus.COMPLETED;
    sprint.completedAt = new Date();
    sprint.committedStoryPoints = committed;
    sprint.completedStoryPoints = completed;
    await sprint.save();

    return {
      sprint,
      movedCount: moved.modifiedCount,
      movedToSprint: target ? { _id: String(target._id), name: target.name } : null,
    };
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