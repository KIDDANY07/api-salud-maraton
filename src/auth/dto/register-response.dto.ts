import { ApiProperty } from '@nestjs/swagger'

export class RegisterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ example: 'promotora.guaduas' })
  username!: string

  @ApiProperty({ example: 'promotora.guaduas@rural-health.test' })
  email!: string

  @ApiProperty({ example: 'Marta' })
  firstName!: string

  @ApiProperty({ example: 'Guzmán' })
  lastName!: string

  @ApiProperty({
    example: true,
    description:
      'Siempre true: la cuenta no tiene rol funcional hasta que un ADMIN se lo asigne',
  })
  pendingApproval!: boolean

  @ApiProperty({
    example:
      'Cuenta creada. Podrá iniciar sesión cuando un administrador le asigne un rol.',
  })
  message!: string
}
