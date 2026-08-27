import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  private hash(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) throw new ConflictException('Email already registered');
    const created = new this.userModel({
      name: dto.name,
      email: dto.email,
      passwordHash: this.hash(dto.password),
      role: dto.role,
    });
    return created.save();
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().select('-passwordHash').exec();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findById(id).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
