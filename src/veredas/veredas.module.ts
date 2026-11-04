import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  loadVeredasDataset,
  VEREDAS_DATASET,
  VeredasCatalogService,
} from './veredas-catalog.service'
import { VeredasController } from './veredas.controller'
import { VeredasService } from './veredas.service'

@Module({
  controllers: [VeredasController],
  providers: [
    {
      provide: VEREDAS_DATASET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        loadVeredasDataset(config.getOrThrow<string>('VEREDAS_DATA_PATH')),
    },
    VeredasCatalogService,
    VeredasService,
  ],
  exports: [VeredasCatalogService],
})
export class VeredasModule {}
