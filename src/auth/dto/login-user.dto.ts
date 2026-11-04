import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, Length } from 'class-validator'

export class LoginUserDto {
  @ApiProperty({
    description: 'Nombre de usuario o correo registrado en Keycloak',
    example: 'coordinador.demo',
  })
  @IsString({ message: 'username debe ser un texto' })
  @IsNotEmpty({ message: 'username es obligatorio' })
  @Length(3, 255, { message: 'username debe tener entre 3 y 255 caracteres' })
  username!: string

  @ApiProperty({
    description: 'Contraseña de la cuenta',
    example: 'Coordinador.Demo1',
    format: 'password',
  })
  @IsString({ message: 'password debe ser un texto' })
  @IsNotEmpty({ message: 'password es obligatorio' })
  @Length(1, 255, { message: 'password debe tener como máximo 255 caracteres' })
  password!: string
}
