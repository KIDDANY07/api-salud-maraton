import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token entregado por /auth/login o /auth/refresh',
  })
  @IsString({ message: 'refreshToken debe ser un texto' })
  @IsNotEmpty({ message: 'refreshToken es obligatorio' })
  @MaxLength(8192, { message: 'refreshToken es demasiado largo' })
  refreshToken!: string
}
