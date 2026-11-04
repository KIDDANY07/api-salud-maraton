import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator'
import { PageQueryDto } from '../../common/dto/page-query.dto'
import { AuditStatus } from '../entities/route-audit-log.entity'

export class FilterRouteAuditDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Fecha y hora inicial (ISO 8601, inclusive)',
    example: '2026-11-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from debe ser una fecha ISO 8601' })
  from?: string

  @ApiPropertyOptional({
    description: 'Fecha y hora final (ISO 8601, inclusive)',
    example: '2026-11-30T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to debe ser una fecha ISO 8601' })
  to?: string

  @ApiPropertyOptional({
    description: 'Filtra por sub, client_id o username del actor',
    example: 'planificador-app',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  actor?: string

  @ApiPropertyOptional({ enum: AuditStatus })
  @IsOptional()
  @IsEnum(AuditStatus, {
    message: 'status debe ser SUCCESS, VALIDATION_ERROR o FORBIDDEN',
  })
  status?: AuditStatus
}
