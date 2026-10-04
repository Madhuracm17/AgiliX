import { IsIn, IsOptional } from 'class-validator';

export class DecideApprovalDto {
  /** Where the task goes: the backlog or the current (active) sprint. */
  @IsOptional()
  @IsIn(['backlog', 'sprint'])
  action?: 'backlog' | 'sprint';
}
