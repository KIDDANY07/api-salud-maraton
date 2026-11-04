import { Injectable } from '@nestjs/common'
import { priorityBandOf } from '../common/utils/priority-band.util'
import { compareIdsAscending } from '../route_engine/strategies/greedy-selection'
import type { VeredasCatalogResponseDto } from './dto/response-vereda.dto'
import { VeredasCatalogService } from './veredas-catalog.service'

@Injectable()
export class VeredasService {
  constructor(private readonly catalog: VeredasCatalogService) {}

  listPublicCatalog(): VeredasCatalogResponseDto {
    const dataset = this.catalog.getDataset()
    return {
      datasetVersion: dataset.datasetVersion,
      simulated: dataset.simulated,
      base: { ...dataset.base },
      veredas: [...dataset.veredas]
        .sort((left, right) => compareIdsAscending(left.id, right.id))
        .map((vereda) => ({
          id: vereda.id,
          nombre: vereda.nombre,
          provincia: vereda.provincia,
          lat: vereda.lat,
          lng: vereda.lng,
          priorityBand: priorityBandOf(vereda.vulnerabilityIndex),
        })),
    }
  }
}
