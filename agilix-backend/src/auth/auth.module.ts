import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtConfig } from './jwt-config';
import { LoginAttempt, LoginAttemptSchema } from './schemas/login-attempt.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: LoginAttempt.name, schema: LoginAttemptSchema },
    ]),
    // No secret here on purpose: JwtConfig supplies it on every sign/verify, so a
    // missing JWT_SECRET disables login instead of stopping the whole backend.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtConfig,
    JwtAuthGuard,
    // Step 3c: every HTTP route requires a login token unless marked @Public().
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
  exports: [JwtModule, JwtConfig, JwtAuthGuard],
})
export class AuthModule {}