import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import { DataSource } from 'typeorm'
import { Public } from '../auth/decorators/public.decorator'
import { VeredasCatalogService } from '../veredas/veredas-catalog.service'

export class DatasetHealthDto {
  @ApiProperty({ example: 'loaded' })
  status!: string

  @ApiProperty({ example: '2026.11-sim.1' })
  datasetVersion!: string

  @ApiProperty()
  datasetHash!: string
}

export class HealthChecksDto {
  @ApiProperty({ example: 'up' })
  database!: string

  @ApiProperty({ type: DatasetHealthDto })
  dataset!: DatasetHealthDto
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto

  @ApiProperty({ format: 'date-time' })
  timestamp!: string
}

@ApiTags('Salud del servicio')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: VeredasCatalogService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Estado del servicio',
    description:
      'Endpoint público: verifica la base de datos y el dataset cargado.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'La base de datos no responde',
  })
  async check(): Promise<HealthResponseDto> {
    const dataset = {
      status: 'loaded',
      datasetVersion: this.catalog.datasetVersion,
      datasetHash: this.catalog.datasetHash,
    }
    try {
      await this.dataSource.query('SELECT 1')
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'La base de datos no responde',
      })
    }
    return {
      status: 'ok',
      checks: { database: 'up', dataset },
      timestamp: new Date().toISOString(),
    }
  }
}
