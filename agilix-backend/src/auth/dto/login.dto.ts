import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  // Generous limit; only stops absurdly large bodies from being hashed.
  @MaxLength(200)
  password: string;
}