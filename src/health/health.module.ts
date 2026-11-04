import { Module } from '@nestjs/common'
import { VeredasModule } from '../veredas/veredas.module'
import { HealthController } from './health.controller'

@Module({
  imports: [VeredasModule],
  controllers: [HealthController],
})
export class HealthModule {}
