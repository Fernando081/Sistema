import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthUser } from './auth-user.entity';
import { AccessProfileController } from './access-profile.controller';
import { AccessProfileService } from './access-profile.service';
import { MfaController } from './mfa.controller';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuthUser])],
  providers: [AuthService, AccessProfileService, PasswordRecoveryService],
  controllers: [AuthController, AccessProfileController, MfaController, PasswordRecoveryController],
  exports: [AuthService],
})
export class AuthModule {}
