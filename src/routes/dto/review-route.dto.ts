import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator'
import { ReviewDecision } from '../entities/route-review.entity'

export const MAX_OBSERVATIONS_LENGTH = 1000

export class ReviewRouteDto {
  @ApiProperty({
    enum: ReviewDecision,
    description: 'Resultado de la validación humana de la ruta sugerida',
  })
  @IsEnum(ReviewDecision, {
    message: 'decision debe ser APROBADA o RECHAZADA',
  })
  decision!: ReviewDecision

  @ApiPropertyOptional({
    maxLength: MAX_OBSERVATIONS_LENGTH,
    example: 'La vía hacia la Vereda Simulada 06 está en mantenimiento.',
    description: 'Obligatorias si la decisión es RECHAZADA',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (dto: ReviewRouteDto) =>
      dto.decision === ReviewDecision.RECHAZADA ||
      dto.observations !== undefined,
  )
  @IsString({ message: 'observations debe ser un texto' })
  @IsNotEmpty({
    message: 'observations es obligatorio cuando la decisión es RECHAZADA',
  })
  @MaxLength(MAX_OBSERVATIONS_LENGTH, {
    message: `observations admite como máximo ${MAX_OBSERVATIONS_LENGTH} caracteres`,
  })
  observations?: string
}
