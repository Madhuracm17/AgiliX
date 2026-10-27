import { IsString, MaxLength, MinLength } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '../schemas/comment.schema';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(COMMENT_MAX_LENGTH)
  text: string;
}
