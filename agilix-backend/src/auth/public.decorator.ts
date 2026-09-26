import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as open to everyone (no login token needed).
 * Every other route requires a valid token (JwtAuthGuard is global).
 *
 * Keep this list short: only routes you must reach BEFORE logging in.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);