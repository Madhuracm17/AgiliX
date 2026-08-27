import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { TaskPriority, TaskStatus } from '../schemas/task.schema';

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
  storyPoints?: number;
}
