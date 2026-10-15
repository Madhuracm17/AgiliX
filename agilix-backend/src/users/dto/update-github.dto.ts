import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

/** GitHub logins: letters, digits and single hyphens, at most 39 characters. "" unlinks. */
export const GITHUB_USERNAME_PATTERN = /^$|^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Body of PATCH /users/:id/github. */
export class UpdateGithubDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/^@/, '') : value))
  @IsString()
  @Matches(GITHUB_USERNAME_PATTERN, {
    message: 'That is not a valid GitHub username (letters, numbers and hyphens, up to 39 characters).',
  })
  githubUsername: string;
}
