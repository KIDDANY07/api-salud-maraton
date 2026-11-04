import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
  })
  configureApp(app)
  const config = app.get(ConfigService)
  const port = config.getOrThrow<number>('PORT')
  await app.listen(port, config.getOrThrow<string>('HOST'))
  app.get(Logger).log(`API escuchando en el puerto ${port}`, 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      context: 'Bootstrap',
      message: 'No se pudo iniciar la API',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  )
  process.exit(1)
})
