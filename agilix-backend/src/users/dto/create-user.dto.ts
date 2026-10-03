import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UserRole } from '../schemas/user.schema';
import { PASSWORD_MAX_LENGTH, PASSWORD_MESSAGE, PASSWORD_PATTERN } from '../../auth/password-policy';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  // Anyone can sign up as a developer or tester. Signing up as a manager or
  // admin also needs the matching access code (see UsersService.signUp).
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  accessCode?: string;
}
