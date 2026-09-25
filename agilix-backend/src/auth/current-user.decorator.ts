import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from './jwt-config';

/**
 * The logged-in user ({ userId, role }) set by JwtAuthGuard.
 * Only use it on routes protected by JwtAuthGuard.
 *
 *   @Get('me')
 *   @UseGuards(JwtAuthGuard)
 *   me(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) throw new UnauthorizedException('Please log in first');
    return request.user;
  },
);