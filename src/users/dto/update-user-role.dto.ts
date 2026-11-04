import { ApiProperty } from '@nestjs/swagger'
import { IsEnum } from 'class-validator'
import { AppRole } from '../../auth/authenticated-user'

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: AppRole,
    description:
      'Nuevo rol funcional; reemplaza el anterior y cierra las sesiones del usuario para que el siguiente token refleje el cambio',
  })
  @IsEnum(AppRole, {
    message: `role debe ser uno de: ${Object.values(AppRole).join(', ')}`,
  })
  role!: AppRole
}
