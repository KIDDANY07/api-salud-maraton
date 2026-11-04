import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator'
import { AppRole } from '../../auth/authenticated-user'
import { PageQueryDto } from '../../common/dto/page-query.dto'

export function parseBooleanQuery(value: unknown): unknown {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return value
}

export class FilterUserDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Texto a buscar en usuario, correo, nombre o apellido',
    example: 'laura',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string

  @ApiPropertyOptional({ enum: AppRole })
  @IsOptional()
  @IsEnum(AppRole, {
    message: `role debe ser uno de: ${Object.values(AppRole).join(', ')}`,
  })
  role?: AppRole

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseBooleanQuery(value))
  @IsBoolean({ message: 'enabled debe ser true o false' })
  enabled?: boolean

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true lista solo las cuentas registradas pendientes de aprobación',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseBooleanQuery(value))
  @IsBoolean({ message: 'pendingApproval debe ser true o false' })
  pendingApproval?: boolean
}
