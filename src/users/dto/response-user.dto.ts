import { ApiProperty } from '@nestjs/swagger'
import { AppRole } from '../../auth/authenticated-user'
import { PageMetaDto } from '../../common/dto/pagination.dto'

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ example: 'enfermera.zipaquira' })
  username!: string

  @ApiProperty({ nullable: true, type: String })
  email!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'Laura' })
  firstName!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'Rincón' })
  lastName!: string | null

  @ApiProperty()
  enabled!: boolean

  @ApiProperty({ enum: AppRole, isArray: true })
  roles!: AppRole[]

  @ApiProperty({
    description:
      'true si la cuenta se registró por /auth/register y espera que un ADMIN le asigne un rol',
  })
  pendingApproval!: boolean

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  createdAt!: string | null
}

export class PaginatedUsersDto {
  @ApiProperty({ type: [UserResponseDto] })
  items!: UserResponseDto[]

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto
}
