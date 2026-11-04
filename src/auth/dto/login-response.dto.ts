import { ApiProperty } from '@nestjs/swagger'
import { ApiScope, AppRole } from '../authenticated-user'
import { Permission } from '../role-permissions'

export class SessionUserDto {
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  sub!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'coordinador.demo' })
  username!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'Coordinadora Demo' })
  name!: string | null

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'coordinador.demo@rural-health.test',
  })
  email!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'rural-routes-web' })
  clientId!: string | null

  @ApiProperty({ enum: AppRole, isArray: true })
  roles!: AppRole[]

  @ApiProperty({
    type: [String],
    example: [ApiScope.ROUTES_READ, ApiScope.ROUTES_WRITE],
  })
  scopes!: string[]

  @ApiProperty({
    enum: Permission,
    isArray: true,
    description:
      'Funcionalidades habilitadas por los roles; útil para que el cliente muestre solo las opciones permitidas',
  })
  permissions!: Permission[]
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Access token JWT para Authorization: Bearer' })
  accessToken!: string

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string

  @ApiProperty({ example: 300, description: 'Vigencia del access token en s' })
  expiresIn!: number

  @ApiProperty({ description: 'Refresh token para renovar la sesión' })
  refreshToken!: string

  @ApiProperty({
    example: 1800,
    description: 'Vigencia del refresh token en segundos',
  })
  refreshExpiresIn!: number

  @ApiProperty({ type: SessionUserDto })
  user!: SessionUserDto
}
