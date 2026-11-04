import { Module, RequestMethod } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LoggerModule } from 'nestjs-pino'
import { stdTimeFunctions } from 'pino'
import { validateEnvironment, type LogLevel } from './app.config'
import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import {
  CREDENTIAL_THROTTLER,
  isCredentialEndpoint,
} from './auth/decorators/credential-endpoint.decorator'
import { JwtAuthGuard } from './auth/guard/jwt-guard'
import { RolesGuard } from './auth/guard/roles.guard'
import { ScopesGuard } from './auth/guard/scopes.guard'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from './common/utils/correlation-id.util'
import { HealthModule } from './health/health.module'
import { RouteEngineModule } from './route_engine/route-engine.module'
import { RoutesModule } from './routes/routes.module'
import { UsersModule } from './users/users.module'
import { VeredasModule } from './veredas/veredas.module'

interface SerializedRequest {
  id?: unknown
  method?: string
  url?: string
  remoteAddress?: string
}

interface SerializedResponse {
  statusCode?: number
}

function assignCorrelationId(
  request: IncomingMessage,
  response: ServerResponse,
): string {
  const correlationId = resolveCorrelationId(
    request.headers[CORRELATION_ID_HEADER],
  )
  response.setHeader(CORRELATION_ID_HEADER, correlationId)
  return correlationId
}

function logLevelFor(
  _request: IncomingMessage,
  response: ServerResponse,
  error?: Error,
): 'error' | 'warn' | 'info' {
  if (error || response.statusCode >= 500) {
    return 'error'
  }
  return response.statusCode >= 400 ? 'warn' : 'info'
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.getOrThrow<LogLevel>('LOG_LEVEL'),
          messageKey: 'message',
          base: { service: 'rural-health-routes' },
          timestamp: stdTimeFunctions.isoTime,
          formatters: { level: (label: string) => ({ level: label }) },
          genReqId: assignCorrelationId,
          quietReqLogger: true,
          customAttributeKeys: { reqId: 'correlationId' },
          customLogLevel: logLevelFor,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'headers.authorization',
              'authorization',
              'access_token',
              'token',
            ],
            remove: true,
          },
          serializers: {
            req: (request: SerializedRequest) => ({
              method: request.method,
              url: request.url,
              remoteAddress: request.remoteAddress,
            }),
            res: (response: SerializedResponse) => ({
              statusCode: response.statusCode,
            }),
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'),
          limit: config.getOrThrow<number>('RATE_LIMIT_MAX'),
        },
        {
          name: CREDENTIAL_THROTTLER,
          ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'),
          limit: config.getOrThrow<number>('LOGIN_RATE_LIMIT_MAX'),
          skipIf: (context) => !isCredentialEndpoint(context),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('URL_DB'),
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: true,
        logging: false,
      }),
    }),
    AuthModule,
    VeredasModule,
    RouteEngineModule,
    AuditModule,
    RoutesModule,
    UsersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: ScopesGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
