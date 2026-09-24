import { IsEnum, IsIn, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { TaskPriority } from '../schemas/task.schema';
import { STORY_POINT_SCALE, STORY_POINT_SCALE_MESSAGE } from '../story-points';

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsMongoId()
  project: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsMongoId()
  assignee?: string;

  @IsOptional()
  @IsNumber()
  @IsIn([...STORY_POINT_SCALE], { message: STORY_POINT_SCALE_MESSAGE })
  storyPoints?: number;
}