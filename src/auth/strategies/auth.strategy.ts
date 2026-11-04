import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { passportJwtSecret } from 'jwks-rsa'
import { ExtractJwt, Strategy } from 'passport-jwt'
import {
  toAuthenticatedUser,
  type AccessTokenClaims,
  type AuthenticatedUser,
} from '../authenticated-user'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: config.getOrThrow<string>('OAUTH_ISSUER'),
      audience: config.getOrThrow<string>('OAUTH_AUDIENCE'),
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: config.getOrThrow<string>('OAUTH_JWKS_URI'),
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        timeout: 5000,
      }),
    })
  }

  validate(claims: AccessTokenClaims): AuthenticatedUser {
    return toAuthenticatedUser(claims)
  }
}
