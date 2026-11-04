import { ApiProperty } from '@nestjs/swagger'
import { ApiScope, AppRole } from '../authenticated-user'
import { Permission } from '../role-permissions'

export class RoleDefinitionDto {
  @ApiProperty({ enum: AppRole })
  role!: AppRole

  @ApiProperty({ example: 'Coordinador de jornadas' })
  label!: string

  @ApiProperty()
  description!: string

  @ApiProperty({ enum: ApiScope, isArray: true })
  scopes!: ApiScope[]

  @ApiProperty({ enum: Permission, isArray: true })
  permissions!: Permission[]
}
