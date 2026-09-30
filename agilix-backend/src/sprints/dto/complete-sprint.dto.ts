import { IsMongoId, IsOptional } from 'class-validator';

/**
 * Options for completing a sprint.
 * moveUnfinishedTo: id of a PLANNED sprint in the same project that should receive
 * the tasks that are not done. Leave it out to send them back to the backlog.
 */
export class CompleteSprintDto {
  @IsOptional()
  @IsMongoId()
  moveUnfinishedTo?: string;
}