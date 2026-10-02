import { IsArray, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // The owner is always the admin who creates the project (taken from the
  // login token), so it is not accepted from the request body.

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  members?: string[];

  @IsOptional()
  @IsIn(['scrum', 'kanban'])
  methodology?: 'scrum' | 'kanban';
}
