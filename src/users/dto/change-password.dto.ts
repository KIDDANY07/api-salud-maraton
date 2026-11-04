import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator'
import {
  PASSWORD_DESCRIPTION,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../auth/account-rules'

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', description: 'Contraseña actual' })
  @IsString({ message: 'currentPassword debe ser un texto' })
  @IsNotEmpty({ message: 'currentPassword es obligatorio' })
  @Length(1, PASSWORD_MAX_LENGTH, {
    message: 'currentPassword es demasiado largo',
  })
  currentPassword!: string

  @ApiProperty({ format: 'password', description: PASSWORD_DESCRIPTION })
  @IsString({ message: 'newPassword debe ser un texto' })
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: PASSWORD_RULE_MESSAGE,
  })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string
}
