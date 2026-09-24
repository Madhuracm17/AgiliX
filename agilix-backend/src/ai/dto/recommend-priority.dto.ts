import { Transform } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of POST /ai/priority.
 * Describes a task (new draft or existing) to recommend a priority for; nothing is saved.
 *
 * There is deliberately NO `priority` field: the task's current priority must never
 * be sent to the AI, so it cannot anchor the recommendation. (The global
 * ValidationPipe uses `whitelist: true`, so an extra `priority` field is stripped.)
 */
export class RecommendPriorityDto {
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

  /** Project the task belongs to — used for project context and reference tasks. */
  @IsMongoId()
  project: string;

  /** Set when recommending for an existing task, so it is not used as its own reference. */
  @IsOptional()
  @IsMongoId()
  taskId?: string;
}