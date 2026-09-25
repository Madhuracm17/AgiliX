import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './jwt-config';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Email + password → login token (valid for JWT_EXPIRES_IN) and the user's details. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Who is logged in. Requires the header: Authorization: Bearer <token>. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId);
  }
}