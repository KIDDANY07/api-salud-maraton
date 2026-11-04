import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { JwtAuthGuard } from './guard/jwt-guard'
import { ScopesGuard } from './guard/scopes.guard'
import { JwtStrategy } from './strategies/auth.strategy'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, ScopesGuard],
  exports: [PassportModule, JwtAuthGuard, ScopesGuard],
})
export class AuthModule {}
