import { ApiProperty } from '@nestjs/swagger'
import { PriorityBand } from '../../common/utils/priority-band.util'

export class BasePlaceDto {
  @ApiProperty({ example: 'BASE-SIM-01' })
  id!: string

  @ApiProperty({ example: 'Base Simulada Puesto de Salud Rural' })
  nombre!: string

  @ApiProperty({ example: 5.131 })
  lat!: number

  @ApiProperty({ example: -74.16 })
  lng!: number
}

export class VeredaResponseDto {
  @ApiProperty({ example: 'VS-01' })
  id!: string

  @ApiProperty({ example: 'Vereda Simulada 01' })
  nombre!: string

  @ApiProperty({ example: 'Rionegro' })
  provincia!: string

  @ApiProperty({ example: 5.162 })
  lat!: number

  @ApiProperty({ example: -74.198 })
  lng!: number

  @ApiProperty({
    enum: PriorityBand,
    description:
      'Banda de prioridad derivada del índice de vulnerabilidad: ALTA (>= 70), MEDIA (40 a 69), BAJA (< 40). El índice numérico solo es visible con el scope audit:read.',
  })
  priorityBand!: PriorityBand
}

export class VeredasCatalogResponseDto {
  @ApiProperty({ example: '2026.11-sim.1' })
  datasetVersion!: string

  @ApiProperty({
    example: true,
    description:
      'Siempre true: el catálogo contiene únicamente datos simulados',
  })
  simulated!: boolean

  @ApiProperty({ type: BasePlaceDto })
  base!: BasePlaceDto

  @ApiProperty({ type: [VeredaResponseDto] })
  veredas!: VeredaResponseDto[]
}
