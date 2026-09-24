import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TaskPriority } from '../../tasks/schemas/task.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of POST /ai/story-points.
 * Describes a task (new draft or existing) to estimate; nothing is saved.
 */
export class EstimateStoryPointsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  /** Project the task belongs to — used for project context and reference tasks. */
  @IsMongoId()
  project: string;

  /** Set when re-estimating an existing task, so it is not used as its own reference. */
  @IsOptional()
  @IsMongoId()
  taskId?: string;
}