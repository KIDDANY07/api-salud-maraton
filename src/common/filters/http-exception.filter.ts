import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common'
import type { Response } from 'express'
import { performance } from 'node:perf_hooks'
import { correlationIdOf } from '../utils/correlation-id.util'
import {
  FAILED_ATTEMPT_RECORDER,
  FailedAttemptStatus,
  type FailedAttemptRecorder,
  type RequestWithContext,
} from './failed-attempt-recorder'

interface ErrorBody {
  statusCode: number
  error: string
  message: string | string[]
}

const AUDITED_STATUSES: ReadonlyMap<number, FailedAttemptStatus> = new Map([
  [HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
])

function errorNameFor(status: number): string {
  const name = HttpStatus[status]
  return typeof name === 'string'
    ? name
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    : 'Error'
}

function toErrorBody(exception: unknown): ErrorBody {
  if (!(exception instanceof HttpException)) {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: errorNameFor(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'Error interno del servidor',
    }
  }
  const statusCode = exception.getStatus()
  const response = exception.getResponse()
  if (typeof response === 'string') {
    return { statusCode, error: errorNameFor(statusCode), message: response }
  }
  const payload = response as Partial<ErrorBody>
  const message =
    typeof payload.message === 'string' || Array.isArray(payload.message)
      ? payload.message
      : exception.message
  return {
    statusCode,
    error:
      typeof payload.error === 'string'
        ? payload.error
        : errorNameFor(statusCode),
    message,
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  constructor(
    @Optional()
    @Inject(FAILED_ATTEMPT_RECORDER)
    private readonly failedAttemptRecorder?: FailedAttemptRecorder,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const context = host.switchToHttp()
    const request = context.getRequest<RequestWithContext>()
    const response = context.getResponse<Response>()
    return this.handle(exception, request, response)
  }

  private async handle(
    exception: unknown,
    request: RequestWithContext,
    response: Response,
  ): Promise<void> {
    const body = toErrorBody(exception)
    const correlationId = correlationIdOf(request)
    if (body.statusCode >= 500) {
      this.logger.error(
        {
          correlationId,
          err: exception instanceof Error ? exception : String(exception),
        },
        'Error no controlado al procesar la solicitud',
      )
    }
    await this.recordAttemptIfNeeded(body, correlationId, request)
    if (response.headersSent) {
      return
    }
    response.status(body.statusCode).json({
      ...body,
      correlationId,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    })
  }

  private async recordAttemptIfNeeded(
    body: ErrorBody,
    correlationId: string,
    request: RequestWithContext,
  ): Promise<void> {
    const attempt = request.routeGenerationAttempt
    const status = AUDITED_STATUSES.get(body.statusCode)
    if (!attempt || !status || !this.failedAttemptRecorder) {
      return
    }
    try {
      await this.failedAttemptRecorder.recordFailedAttempt({
        status,
        correlationId,
        user: request.user,
        receivedParameters: request.body as unknown,
        errorDetails: { statusCode: body.statusCode, message: body.message },
        durationMs: Math.max(
          0,
          Math.round(performance.now() - attempt.startedAt),
        ),
      })
    } catch (error) {
      this.logger.error(
        {
          correlationId,
          err: error instanceof Error ? error.message : String(error),
        },
        'No se pudo registrar la auditoría del intento fallido',
      )
    }
  }
}
