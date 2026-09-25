import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtConfig } from './jwt-config';

@Module({
  imports: [
    UsersModule,
    // No secret here on purpose: JwtConfig supplies it on every sign/verify, so a
    // missing JWT_SECRET disables login instead of stopping the whole backend.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtConfig, JwtAuthGuard],
  // Exported so other modules can use @UseGuards(JwtAuthGuard) later (Step 3c / RBAC).
  exports: [JwtModule, JwtConfig, JwtAuthGuard],
})
export class AuthModule {}