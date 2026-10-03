import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

/** bcrypt cost factor — 10 is the widely used default (salted, ~100 ms per hash). */
const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  private hash(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) throw new ConflictException('Email already registered');
    const created = new this.userModel({
      name: dto.name,
      email: dto.email,
      passwordHash: await this.hash(dto.password),
      role: dto.role,
    });
    // The schema's toJSON transform removes passwordHash from the API response.
    return created.save();
  }

  /**
   * Public sign-up. Developer and tester need nothing extra. Manager and admin
   * also need an access code that the organisation sets in the backend .env
   * (MANAGER_SIGNUP_CODE / ADMIN_SIGNUP_CODE), so nobody can make themselves
   * a manager or admin without it, and nobody has to edit the database.
   */
  async signUp(dto: CreateUserDto): Promise<User> {
    const role = dto.role ?? UserRole.DEVELOPER;
    if (role === UserRole.ADMIN || role === UserRole.MANAGER) {
      const expected =
        role === UserRole.ADMIN
          ? process.env.ADMIN_SIGNUP_CODE
          : process.env.MANAGER_SIGNUP_CODE;
      if (!expected) {
        throw new ForbiddenException(
          `Sign-up as ${role} is not enabled. Please contact an admin to create the account for you.`,
        );
      }
      if (!this.sameCode(dto.accessCode ?? '', expected)) {
        throw new ForbiddenException(
          `The access code is not correct. Please check it with your organisation.`,
        );
      }
    }
    const { accessCode: _ignored, ...rest } = dto;
    return this.create({ ...rest, role });
  }

  private sameCode(given: string, expected: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().select('-passwordHash').exec();
  }

  /**
   * Login only: the one query that loads passwordHash (hidden everywhere else).
   * Never return this document from an API route.
   */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+passwordHash').exec();
  }

  /** Saves a new bcrypt hash for the user (used to upgrade old SHA-256 passwords on login). */
  async setPassword(id: string, password: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { passwordHash: await this.hash(password) })
      .exec();
  }

  /**
   * Changes a user's role. An admin cannot change their own role, so the
   * workspace can never be left without an admin. The new role applies from the
   * person's next request (the role is read from the database, not the token).
   */
  async setRole(id: string, role: UserRole, actingUserId: string): Promise<User> {
    if (id === actingUserId) {
      throw new BadRequestException('You cannot change your own role');
    }
    const user = await this.userModel
      .findByIdAndUpdate(id, { role }, { new: true })
      .select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findById(id).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}