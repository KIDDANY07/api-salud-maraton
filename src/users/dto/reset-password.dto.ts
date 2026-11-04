import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length, Matches } from 'class-validator'
import {
  PASSWORD_DESCRIPTION,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../auth/account-rules'

export class ResetPasswordDto {
  @ApiProperty({ format: 'password', description: PASSWORD_DESCRIPTION })
  @IsString({ message: 'password debe ser un texto' })
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: PASSWORD_RULE_MESSAGE,
  })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string
}
