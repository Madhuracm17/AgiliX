import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** What an admin or manager can change on an existing project. */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'The project name cannot be empty' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn([...PROJECT_STATUSES], { message: 'Status must be active, on_hold or completed' })
  status?: ProjectStatus;
}
