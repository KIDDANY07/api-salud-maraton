import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator'
import { PageQueryDto } from '../../common/dto/page-query.dto'
import { RouteStrategyName } from '../../route_engine/strategies/route-strategy.interface'
import { RouteReviewStatus } from '../entities/route-review.entity'

export class FilterRouteDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Fecha y hora inicial de generación (ISO 8601, inclusive)',
    example: '2026-11-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from debe ser una fecha ISO 8601' })
  from?: string

  @ApiPropertyOptional({
    description: 'Fecha y hora final de generación (ISO 8601, inclusive)',
    example: '2026-11-30T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to debe ser una fecha ISO 8601' })
  to?: string

  @ApiPropertyOptional({ enum: RouteStrategyName })
  @IsOptional()
  @IsEnum(RouteStrategyName, {
    message: `strategy debe ser uno de: ${Object.values(RouteStrategyName).join(', ')}`,
  })
  strategy?: RouteStrategyName

  @ApiPropertyOptional({ enum: RouteReviewStatus })
  @IsOptional()
  @IsEnum(RouteReviewStatus, {
    message: `reviewStatus debe ser uno de: ${Object.values(RouteReviewStatus).join(', ')}`,
  })
  reviewStatus?: RouteReviewStatus

  @ApiPropertyOptional({
    description: 'sub, username o client_id de quien generó la ruta',
    example: 'coordinador.demo',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  createdBy?: string
}
