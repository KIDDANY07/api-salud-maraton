import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator'
import {
  DEFAULT_ROUTE_PARAMETERS,
  type RouteParametersInput,
} from '../../route_engine/route-calculator.service'
import { RouteStrategyName } from '../../route_engine/strategies/route-strategy.interface'

export const VEREDA_ID_PATTERN = /^[A-Za-z0-9-]{1,40}$/
export const MAX_EXCLUDED_VEREDAS = 50

const STRATEGY_NAMES = Object.values(RouteStrategyName).join(', ')

export class CreateRouteDto implements RouteParametersInput {
  @ApiPropertyOptional({
    enum: RouteStrategyName,
    default: DEFAULT_ROUTE_PARAMETERS.strategy,
    description: 'Estrategia de priorización',
  })
  @IsOptional()
  @IsEnum(RouteStrategyName, {
    message: 'strategy debe ser uno de: ' + STRATEGY_NAMES,
  })
  strategy?: RouteStrategyName

  @ApiPropertyOptional({
    default: DEFAULT_ROUTE_PARAMETERS.visitCount,
    minimum: 1,
    description:
      'Cantidad de veredas a visitar en la jornada; entero entre 1 y el número de veredas disponibles tras las exclusiones',
  })
  @IsOptional()
  @IsInt({ message: 'visitCount debe ser un número entero' })
  @Min(1, { message: 'visitCount debe ser mayor o igual a 1' })
  visitCount?: number

  @ApiPropertyOptional({
    default: DEFAULT_ROUTE_PARAMETERS.alpha,
    minimum: 0,
    maximum: 1,
    description:
      'Peso de la vulnerabilidad frente a la cercanía; solo aplica a VULNERABILITY_WEIGHTED',
  })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'alpha debe ser un número' },
  )
  @Min(0, { message: 'alpha debe estar entre 0 y 1' })
  @Max(1, { message: 'alpha debe estar entre 0 y 1' })
  alpha?: number

  @ApiPropertyOptional({
    default: DEFAULT_ROUTE_PARAMETERS.returnToBase,
    description: 'Si es true se suma el tramo de regreso a la base',
  })
  @IsOptional()
  @IsBoolean({ message: 'returnToBase debe ser booleano' })
  returnToBase?: boolean

  @ApiPropertyOptional({
    type: [String],
    example: ['VS-04'],
    description:
      'Veredas que no deben visitarse en esta jornada, por ejemplo por una vía cerrada',
  })
  @IsOptional()
  @IsArray({ message: 'excludedVeredaIds debe ser una lista' })
  @ArrayMaxSize(MAX_EXCLUDED_VEREDAS, {
    message: 'excludedVeredaIds admite como máximo 50 elementos',
  })
  @ArrayUnique({ message: 'excludedVeredaIds no debe tener valores repetidos' })
  @Matches(VEREDA_ID_PATTERN, {
    each: true,
    message: 'cada id de excludedVeredaIds debe ser alfanumérico, con guiones',
  })
  excludedVeredaIds?: string[]
}
