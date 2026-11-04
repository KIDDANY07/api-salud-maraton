import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { ApiScope } from './auth/authenticated-user'
import { CORRELATION_ID_HEADER } from './common/utils/correlation-id.util'
import { ALGORITHM_VERSION } from './route_engine/route-calculator.service'

export const API_PREFIX = 'api/v1'
export const DOCS_PATH = 'docs'

function setupSwagger(app: NestExpressApplication, tokenUrl: string): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Priorización de visitas domiciliarias rurales')
      .setDescription(
        'Microservicio de demostración que sugiere el orden de visita de un equipo de salud a veredas rurales de Cundinamarca. Usa datos simulados y su resultado siempre requiere validación humana. Para probarlo, autorice con OAuth 2.0 (Client Credentials) usando planificador-app o auditor-app.',
      )
      .setVersion(ALGORITHM_VERSION)
      .addOAuth2(
        {
          type: 'oauth2',
          description: 'Keycloak, flujo Client Credentials',
          flows: {
            clientCredentials: {
              tokenUrl,
              scopes: {
                [ApiScope.ROUTES_READ]: 'Consultar rutas y veredas',
                [ApiScope.ROUTES_WRITE]: 'Generar rutas sugeridas',
                [ApiScope.AUDIT_READ]: 'Consultar auditoría y desglose',
              },
            },
          },
        },
        'oauth2',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token emitido por Keycloak',
        },
        'bearer',
      )
      .build(),
  )
  SwaggerModule.setup(DOCS_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  })
}

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService)
  const tokenUrl = config.getOrThrow<string>('OAUTH_TOKEN_URL')
  const corsOrigins = config.getOrThrow<string[]>('CORS_ORIGINS')
  app.useLogger(app.get(Logger))
  app.disable('x-powered-by')
  app.setGlobalPrefix(API_PREFIX)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          connectSrc: ["'self'", new URL(tokenUrl).origin],
          upgradeInsecureRequests: null,
        },
      },
    }),
  )
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type', CORRELATION_ID_HEADER],
    exposedHeaders: [CORRELATION_ID_HEADER],
    maxAge: 600,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.enableShutdownHooks()
  if (config.getOrThrow<boolean>('SWAGGER_ENABLED')) {
    setupSwagger(app, tokenUrl)
  }
}
