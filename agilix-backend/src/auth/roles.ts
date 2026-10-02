import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/schemas/user.schema';
import { AuthUser } from './jwt-config';

/**
 * Throws 403 unless the logged-in user has one of the given roles.
 * The role comes from the signed login token, so it cannot be faked by the client.
 *
 *   requireRole(user, 'Only admins can create projects', UserRole.ADMIN);
 */
export function requireRole(user: AuthUser, message: string, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) throw new ForbiddenException(message);
}
