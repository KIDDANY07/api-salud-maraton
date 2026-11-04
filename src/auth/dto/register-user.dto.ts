import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator'
import {
  PASSWORD_DESCRIPTION,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
  USERNAME_PATTERN,
  USERNAME_RULE_MESSAGE,
} from '../account-rules'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class RegisterUserDto {
  @ApiProperty({
    example: 'promotora.guaduas',
    description:
      'Minúsculas, números, punto, guion o guion bajo; entre 3 y 50 caracteres',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'username debe ser un texto' })
  @Matches(USERNAME_PATTERN, { message: USERNAME_RULE_MESSAGE })
  username!: string

  @ApiProperty({ example: 'promotora.guaduas@rural-health.test' })
  @Transform(trimmed)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @MaxLength(254, { message: 'email es demasiado largo' })
  email!: string

  @ApiProperty({ example: 'Marta' })
  @Transform(trimmed)
  @IsString({ message: 'firstName debe ser un texto' })
  @Length(1, 100, { message: 'firstName debe tener entre 1 y 100 caracteres' })
  firstName!: string

  @ApiProperty({ example: 'Guzmán' })
  @Transform(trimmed)
  @IsString({ message: 'lastName debe ser un texto' })
  @Length(1, 100, { message: 'lastName debe tener entre 1 y 100 caracteres' })
  lastName!: string

  @ApiProperty({
    format: 'password',
    example: 'Promueve.Salud2026',
    description: PASSWORD_DESCRIPTION,
  })
  @IsString({ message: 'password debe ser un texto' })
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: PASSWORD_RULE_MESSAGE,
  })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string
}
