import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** "owner/name" as on github.com, or an empty string to unlink the repo. */
export const GITHUB_REPO_PATTERN = /^$|^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

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

  /** Kanban WIP limit for the In Progress column. 0 turns the limit off. */
  @IsOptional()
  @IsInt({ message: 'The WIP limit must be a whole number' })
  @Min(0, { message: 'The WIP limit cannot be negative' })
  @Max(100, { message: 'The WIP limit can be at most 100' })
  wipLimit?: number;

  /** GitHub repository as "owner/name". Send "" to unlink it. */
  @IsOptional()
  @IsString()
  @Matches(GITHUB_REPO_PATTERN, {
    message: 'The GitHub repository must look like owner/name, e.g. Madhuracm17/AgiliX',
  })
  githubRepo?: string;
}
