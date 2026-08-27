import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { TaskPriority } from '../schemas/task.schema';

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
  storyPoints?: number;
}
