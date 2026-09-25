import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../users/schemas/user.schema';

/** A shorter secret is too easy to guess, so login stays disabled until it is fixed. */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_EXPIRES_IN = '1d';
/** A number followed by a unit: s (seconds), m (minutes), h (hours) or d (days). */
const EXPIRES_IN_PATTERN = /^\d+[smhd]$/;

/** Only HS256 tokens signed with JWT_SECRET are ever accepted. */
export const JWT_ALGORITHM = 'HS256';

/** What is stored inside a login token. Kept minimal on purpose. */
export interface JwtPayload {
  /** The user's MongoDB _id. */
  sub: string;
  role: UserRole;
}

/** The logged-in user, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  role: UserRole;
}

export interface JwtSettings {
  secret: string;
  expiresIn: string;
}

/**
 * Reads JWT_SECRET / JWT_EXPIRES_IN from .env in one place.
 *
 * If they are missing or invalid the backend still starts (so teammates who have not
 * added the secret yet are not blocked); only login and token checks are refused.
 */
@Injectable()
export class JwtConfig implements OnModuleInit {
  private readonly logger = new Logger('Auth');

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const problem = this.findProblem();
    if (problem) {
      this.logger.warn(`${problem} Login is disabled until this is fixed in .env.`);
    }
  }

  /** Throws 503 when authentication is not configured on this server. */
  get settings(): JwtSettings {
    if (this.findProblem()) {
      throw new ServiceUnavailableException('Login is not configured on this server.');
    }
    return { secret: this.secret(), expiresIn: this.expiresIn() };
  }

  private secret(): string {
    return (this.config.get<string>('JWT_SECRET') ?? '').trim();
  }

  private expiresIn(): string {
    return (this.config.get<string>('JWT_EXPIRES_IN') ?? '').trim() || DEFAULT_EXPIRES_IN;
  }

  private findProblem(): string | null {
    const secret = this.secret();
    if (!secret) return 'JWT_SECRET is not set.';
    if (secret.length < MIN_SECRET_LENGTH) {
      return `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`;
    }
    if (!EXPIRES_IN_PATTERN.test(this.expiresIn())) {
      return 'JWT_EXPIRES_IN must look like 30m, 12h or 1d.';
    }
    return null;
  }
}