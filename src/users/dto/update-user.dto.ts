import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'laura.rincon@rural-health.test' })
  @IsOptional()
  @Transform(trimmed)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @MaxLength(254, { message: 'email es demasiado largo' })
  email?: string

  @ApiPropertyOptional({ example: 'Laura' })
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'firstName debe ser un texto' })
  @Length(1, 100, { message: 'firstName debe tener entre 1 y 100 caracteres' })
  firstName?: string

  @ApiPropertyOptional({ example: 'Rincón' })
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'lastName debe ser un texto' })
  @Length(1, 100, { message: 'lastName debe tener entre 1 y 100 caracteres' })
  lastName?: string

  @ApiPropertyOptional({
    description:
      'false deshabilita la cuenta y cierra sus sesiones; un administrador no puede deshabilitarse a sí mismo',
  })
  @IsOptional()
  @IsBoolean({ message: 'enabled debe ser booleano' })
  enabled?: boolean
}
