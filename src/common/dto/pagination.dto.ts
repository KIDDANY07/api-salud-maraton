import { ApiProperty } from '@nestjs/swagger'

export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number

  @ApiProperty({ example: 20 })
  limit!: number

  @ApiProperty({ example: 42 })
  totalItems!: number

  @ApiProperty({ example: 3 })
  totalPages!: number

  @ApiProperty({ example: true })
  hasNextPage!: boolean
}
