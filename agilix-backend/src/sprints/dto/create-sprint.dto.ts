import { IsDateString, IsMongoId, IsString } from 'class-validator';

export class CreateSprintDto {
  @IsString()
  name: string;

  @IsMongoId()
  project: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
