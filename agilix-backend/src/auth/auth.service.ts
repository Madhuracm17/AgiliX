import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { User } from '../users/schemas/user.schema';
import { LoginDto } from './dto/login.dto';
import { JWT_ALGORITHM, JwtConfig, JwtPayload } from './jwt-config';
import { LoginAttempt, LoginAttemptDocument } from './schemas/login-attempt.schema';

/** Wrong passwords allowed before the account is locked. */
export const MAX_LOGIN_ATTEMPTS = 3;
/** How long the account stays locked. */
export const LOCK_MINUTES = 15;
/** Shown when someone asks to reset the password of an email that has no account. */
export const NO_ACCOUNT_MESSAGE =
  'No account found with this email id. Please create a new account.';

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
    @InjectModel(LoginAttempt.name) private readonly attempts: Model<LoginAttemptDocument>,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    // Fail fast (503) if JWT_SECRET is missing, before touching any password.
    const { secret, expiresIn } = this.jwtConfig.settings;

    // Three wrong passwords lock the account for 15 minutes. While it is locked
    // even the right password is refused.
    const attemptKey = this.attemptKey(dto.email);
    await this.assertNotLocked(attemptKey);

    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user) {
      await bcrypt.compare(dto.password, this.getDummyHash());
      throw await this.failedAttempt(attemptKey);
    }

    const { valid, isLegacy } = await this.checkPassword(dto.password, user.passwordHash);
    if (!valid) throw await this.failedAttempt(attemptKey);

    await this.attempts.deleteOne({ email: attemptKey }).exec();

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

  // ---------------------------------------------------------------------------
  // Login attempts (at most 3 wrong passwords, then a 15 minute lock)
  // ---------------------------------------------------------------------------

  private attemptKey(email: string): string {
    return email.trim().toLowerCase();
  }

  private lockedMessage(until: Date): string {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return (
      `Too many wrong password attempts. This account is locked for ${minutes} more ` +
      `${minutes === 1 ? 'minute' : 'minutes'}. You can wait, or use "Forgot password" to reset it.`
    );
  }

  /** Throws a 429 while the account is locked; clears a lock that has run out. */
  private async assertNotLocked(key: string): Promise<void> {
    const record = await this.attempts.findOne({ email: key }).exec();
    if (!record?.lockedUntil) return;
    if (record.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(this.lockedMessage(record.lockedUntil), HttpStatus.TOO_MANY_REQUESTS);
    }
    // The lock has ended: start counting again from zero.
    await this.attempts.deleteOne({ email: key }).exec();
  }

  /** Counts a wrong password and returns the error to throw (401, or 429 once locked). */
  private async failedAttempt(key: string): Promise<HttpException> {
    const record = await this.attempts
      .findOneAndUpdate({ email: key }, { $inc: { count: 1 } }, { upsert: true, new: true })
      .exec();
    const count = record?.count ?? 1;

    if (count >= MAX_LOGIN_ATTEMPTS) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await this.attempts.updateOne({ email: key }, { lockedUntil: until }).exec();
      return new HttpException(this.lockedMessage(until), HttpStatus.TOO_MANY_REQUESTS);
    }

    const left = MAX_LOGIN_ATTEMPTS - count;
    return new UnauthorizedException(
      `${INVALID_CREDENTIALS}. You have ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Forgot password / reset password
  // ---------------------------------------------------------------------------

  /** Step 1: is there an account with this email? */
  async forgotPassword(email: string): Promise<{ found: true; message: string }> {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user) throw new NotFoundException(NO_ACCOUNT_MESSAGE);
    return { found: true, message: 'Account found. Create a new password.' };
  }

  /** Step 2: sets a new password for that account, and ends any login lock. */
  async resetPassword(email: string, password: string): Promise<{ message: string }> {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user) throw new NotFoundException(NO_ACCOUNT_MESSAGE);

    await this.users.setPassword(String(user._id), password);
    // A reset also ends a lock caused by too many wrong passwords.
    await this.attempts.deleteOne({ email: this.attemptKey(user.email) }).exec();

    return { message: 'Your password has been changed. You can log in now.' };
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