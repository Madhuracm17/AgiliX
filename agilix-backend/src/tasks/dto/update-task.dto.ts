import { IsEnum, IsIn, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { TaskPriority, TaskStatus } from '../schemas/task.schema';
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
}