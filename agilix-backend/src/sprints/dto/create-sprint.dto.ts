import { IsDateString, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSprintDto {
  @IsString()
  name: string;

  @IsMongoId()
  project: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  goal?: string;

  @IsDateString()
  startDate: string;

  // Must be on or after startDate (checked in SprintsService).
  @IsDateString()
  endDate: string;
}