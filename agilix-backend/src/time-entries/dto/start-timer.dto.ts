import { IsMongoId } from 'class-validator';

export class StartTimerDto {
  @IsMongoId()
  task: string;

  @IsMongoId()
  project: string;

  @IsMongoId()
  user: string;
}