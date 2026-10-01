import { IsMongoId } from 'class-validator';

/**
 * Body of POST /ai/task-suggestions.
 * Only the project id is needed: the project details and its existing tasks
 * are read from the database. Nothing is created or saved.
 */
export class SuggestTasksDto {
  @IsMongoId()
  projectId: string;
}