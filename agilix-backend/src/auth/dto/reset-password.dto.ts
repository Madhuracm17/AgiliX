import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MESSAGE, PASSWORD_PATTERN } from '../password-policy';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
