import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import { performance } from 'node:perf_hooks'
import type { RequestWithContext } from '../common/filters/failed-attempt-recorder'

@Injectable()
export class RouteAttemptMiddleware implements NestMiddleware {
  use(request: RequestWithContext, _response: Response, next: NextFunction) {
    request.routeGenerationAttempt = { startedAt: performance.now() }
    next()
  }
}
