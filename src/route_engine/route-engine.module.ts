import { Module } from '@nestjs/common'
import { RouteCalculatorService } from './route-calculator.service'
import { NearestNeighborStrategy } from './strategies/nearest-neighbor.strategy'
import {
  ROUTE_STRATEGIES,
  type RouteStrategy,
} from './strategies/route-strategy.interface'
import { VulnerabilityWeightedStrategy } from './strategies/vulnerability-weighted.strategy'

@Module({
  providers: [
    VulnerabilityWeightedStrategy,
    NearestNeighborStrategy,
    {
      provide: ROUTE_STRATEGIES,
      inject: [VulnerabilityWeightedStrategy, NearestNeighborStrategy],
      useFactory: (...strategies: RouteStrategy[]): RouteStrategy[] =>
        strategies,
    },
    RouteCalculatorService,
  ],
  exports: [RouteCalculatorService],
})
export class RouteEngineModule {}
