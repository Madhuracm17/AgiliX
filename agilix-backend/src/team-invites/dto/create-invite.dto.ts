import { IsMongoId } from 'class-validator';

export class CreateInviteDto {
  @IsMongoId()
  userId: string;
}
