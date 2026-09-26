import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/schemas/user.schema';
import { AuthUser, JWT_ALGORITHM, JwtConfig, JwtPayload } from './jwt-config';
import { IS_PUBLIC_KEY } from './public.decorator';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const ROLES = new Set<string>(Object.values(UserRole));

/** The parts of the HTTP request this guard reads and writes. */
interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

/**
 * Global guard (registered in AuthModule): every HTTP route requires a valid token
 *   Authorization: Bearer <token>
 * except routes marked @Public().
 *
 * On success, the logged-in user is available as request.user (see @CurrentUser()).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly jwtConfig: JwtConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = readBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Please log in first');

    const { secret } = this.jwtConfig.settings;

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new UnauthorizedException('Your login has expired or is invalid. Please log in again');
    }

    if (
      typeof payload.sub !== 'string' ||
      !OBJECT_ID_PATTERN.test(payload.sub) ||
      !ROLES.has(payload.role)
    ) {
      throw new UnauthorizedException('Your login has expired or is invalid. Please log in again');
    }

    request.user = { userId: payload.sub, role: payload.role };
    return true;
  }
}

function readBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}