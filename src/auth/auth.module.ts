import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guard/jwt-guard'
import { KeycloakAdminService } from './keycloak-admin.service'
import { RolesGuard } from './guard/roles.guard'
import { ScopesGuard } from './guard/scopes.guard'
import { JwtStrategy } from './strategies/auth.strategy'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    ScopesGuard,
    RolesGuard,
    KeycloakAdminService,
    AuthService,
  ],
  exports: [
    PassportModule,
    JwtAuthGuard,
    ScopesGuard,
    RolesGuard,
    KeycloakAdminService,
    AuthService,
  ],
})
export class AuthModule {}
