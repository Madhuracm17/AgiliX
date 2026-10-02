import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
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
   * workspace can never be left without an admin. The person's current login
   * keeps the old role until they log in again.
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