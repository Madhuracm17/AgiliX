/**
 * The password rule. It must match the backend (auth/password-policy.ts):
 * at least 8 characters, with a digit and a special character.
 */
export const PASSWORD_HINT = "At least 8 characters, with a number and a special character.";

const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

/** A sentence saying what is wrong with the password, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  return PASSWORD_PATTERN.test(password)
    ? null
    : "Password must be at least 8 characters long and include a number and a special character (for example ! @ # $ %).";
}
