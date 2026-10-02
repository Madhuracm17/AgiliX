import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../schemas/user.schema';

/** Roles a person may pick for themselves when signing up. */
export const SIGNUP_ROLES = [UserRole.DEVELOPER, UserRole.TESTER] as const;

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  // Sign-up can only create developers or testers. Admins and managers are
  // set by editing "role" on the user in MongoDB Atlas.
  @IsOptional()
  @IsIn(SIGNUP_ROLES, { message: 'role must be developer or tester' })
  role?: UserRole;
}
