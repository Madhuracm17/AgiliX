import { IsMongoId, IsOptional } from 'class-validator';

/**
 * Starts a timer on a task. The person is always the logged-in user (taken from
 * the login token), and the project is taken from the task, so neither is sent.
 */
export class StartTimerDto {
  @IsMongoId()
  task: string;

  // Older versions of the web app still send this; it is ignored.
  @IsOptional()
  @IsMongoId()
  project?: string;
}
