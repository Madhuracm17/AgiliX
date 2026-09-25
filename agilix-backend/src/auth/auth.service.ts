import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { User } from '../users/schemas/user.schema';
import { LoginDto } from './dto/login.dto';
import { JWT_ALGORITHM, JwtConfig, JwtPayload } from './jwt-config';

/** Same message for unknown email and wrong password, so login cannot reveal who is registered. */
const INVALID_CREDENTIALS = 'Invalid email or password';

/** Passwords saved before bcrypt was introduced: plain SHA-256, 64 hex characters. */
const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: { _id: string; name: string; email: string; role: User['role'] };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  /** Used when the email is unknown, so that case takes as long as a wrong password. */
  private dummyHash: string | undefined;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly jwtConfig: JwtConfig,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    // Fail fast (503) if JWT_SECRET is missing, before touching any password.
    const { secret, expiresIn } = this.jwtConfig.settings;

    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user) {
      await bcrypt.compare(dto.password, this.getDummyHash());
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const { valid, isLegacy } = await this.checkPassword(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const userId = String(user._id);

    if (isLegacy) {
      // One-time upgrade: re-save the old SHA-256 password as bcrypt.
      try {
        await this.users.setPassword(userId, dto.password);
        this.logger.log(`Upgraded a legacy password hash to bcrypt (user ${userId})`);
      } catch (error) {
        // Login still succeeds; the upgrade is retried on the next login.
        this.logger.warn(`Could not upgrade legacy password hash (user ${userId}): ${String(error)}`);
      }
    }

    const payload: JwtPayload = { sub: userId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret,
      algorithm: JWT_ALGORITHM,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: { _id: userId, name: user.name, email: user.email, role: user.role },
    };
  }

  /** The current user, always read fresh from the database (never from the token alone). */
  async me(userId: string): Promise<User> {
    try {
      return await this.users.findOne(userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('This account no longer exists');
      }
      throw error;
    }
  }

  private async checkPassword(
    password: string,
    storedHash: string | undefined,
  ): Promise<{ valid: boolean; isLegacy: boolean }> {
    if (!storedHash) return { valid: false, isLegacy: false };

    if (LEGACY_SHA256_PATTERN.test(storedHash)) {
      const attempt = crypto.createHash('sha256').update(password).digest('hex');
      const valid = crypto.timingSafeEqual(
        Buffer.from(attempt, 'hex'),
        Buffer.from(storedHash.toLowerCase(), 'hex'),
      );
      return { valid, isLegacy: true };
    }

    return { valid: await bcrypt.compare(password, storedHash), isLegacy: false };
  }

  private getDummyHash(): string {
    this.dummyHash ??= bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
    return this.dummyHash;
  }
}