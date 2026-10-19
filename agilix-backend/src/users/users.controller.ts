import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateGithubDto } from './dto/update-github.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { requireRole } from '../auth/roles';
import { UserRole } from './schemas/user.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public so new people can create an account from the login page.
  // CreateUserDto only accepts the roles developer and tester, except that
  // the very first account in an empty workspace becomes the admin.
  @Public()
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.signUp(dto);
  }

  /**
   * Admins and managers create accounts for other people.
   * Admins can give any role; managers can create developers and testers.
   */
  @Post('account')
  createAccount(@Body() dto: CreateAccountDto, @CurrentUser() user: AuthUser) {
    requireRole(
      user,
      'You do not have permission to create accounts. Please contact an admin.',
      UserRole.ADMIN,
      UserRole.MANAGER,
    );
    const role = dto.role ?? UserRole.DEVELOPER;
    if (user.role === UserRole.MANAGER && role !== UserRole.DEVELOPER && role !== UserRole.TESTER) {
      throw new ForbiddenException(
        'You do not have permission to create accounts with this role. Please contact an admin.',
      );
    }
    return this.usersService.create({ ...dto, role });
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  /** Admins only: change someone's role (admin, manager, developer or tester). */
  @Patch(':id/role')
  setRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthUser) {
    requireRole(user, 'You do not have permission to change roles. Please contact an admin.', UserRole.ADMIN);
    return this.usersService.setRole(id, dto.role, user.userId);
  }

  /**
   * Link a GitHub username. ":id" can be "me". People set their own; admins and
   * managers can also set it for someone else.
   */
  @Patch(':id/github')
  setGithub(@Param('id') id: string, @Body() dto: UpdateGithubDto, @CurrentUser() user: AuthUser) {
    const target = id === 'me' ? user.userId : id;
    if (!isValidObjectId(target)) throw new BadRequestException('Invalid user id');
    if (target !== user.userId) {
      requireRole(
        user,
        'You can only change your own GitHub username. Please ask a manager or an admin.',
        UserRole.ADMIN,
        UserRole.MANAGER,
      );
    }
    return this.usersService.setGithubUsername(target, dto.githubUsername);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}