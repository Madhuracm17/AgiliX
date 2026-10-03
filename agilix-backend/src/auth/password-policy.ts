/**
 * The password rule used everywhere a password is chosen (sign-up, accounts
 * created by an admin or manager, and password reset): at least 8 characters,
 * with at least one digit and at least one special character.
 *
 * Login does not use it, so people whose older, weaker password still works
 * can keep logging in until they change it.
 */
export const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

export const PASSWORD_MESSAGE =
  'Password must be at least 8 characters long and include a number and a special character (for example ! @ # $ %).';

/** Longest password accepted (bcrypt only uses the first 72 bytes anyway). */
export const PASSWORD_MAX_LENGTH = 72;
