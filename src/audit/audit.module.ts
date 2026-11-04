import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FAILED_ATTEMPT_RECORDER } from '../common/filters/failed-attempt-recorder'
import { RouteEngineModule } from '../route_engine/route-engine.module'
import { VeredasModule } from '../veredas/veredas.module'
import { AuditChainService } from './audit-chain.service'
import { AuditWriterService } from './audit-writer.service'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'
import { RouteAuditLog } from './entities/route-audit-log.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([RouteAuditLog]),
    RouteEngineModule,
    VeredasModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditChainService,
    AuditWriterService,
    AuditService,
    { provide: FAILED_ATTEMPT_RECORDER, useExisting: AuditWriterService },
  ],
  exports: [AuditWriterService, FAILED_ATTEMPT_RECORDER],
})
export class AuditModule {}
