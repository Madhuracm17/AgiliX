import { IsEnum, IsIn, IsMongoId, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskPriority, TaskStatus, TaskType } from '../schemas/task.schema';
import { STORY_POINT_SCALE, STORY_POINT_SCALE_MESSAGE } from '../story-points';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsMongoId()
  sprint?: string | null;

  @IsOptional()
  @IsMongoId()
  assignee?: string | null;

  @IsOptional()
  @IsNumber()
  @IsIn([...STORY_POINT_SCALE], { message: STORY_POINT_SCALE_MESSAGE })
  storyPoints?: number;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  // Required when a tester sends a task back from Review to In Progress.
  // Not stored as a field of its own: it becomes the task's reviewNote.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewComment?: string;
}
