import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuditModule } from '../audit/audit.module'
import { RouteEngineModule } from '../route_engine/route-engine.module'
import { VeredasModule } from '../veredas/veredas.module'
import { RouteReview } from './entities/route-review.entity'
import { Route } from './entities/route.entity'
import { RouteAttemptMiddleware } from './route-attempt.middleware'
import { RoutesController } from './routes.controller'
import { RoutesService } from './routes.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([Route, RouteReview]),
    RouteEngineModule,
    VeredasModule,
    AuditModule,
  ],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RouteAttemptMiddleware)
      .forRoutes({ path: 'routes', method: RequestMethod.POST })
  }
}
