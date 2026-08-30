import { IsArray, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsMongoId()
  owner: string;

  @IsOptional()
  @IsArray()
  members?: string[];

  @IsOptional()
  @IsIn(['scrum', 'kanban'])
  methodology?: 'scrum' | 'kanban';
}