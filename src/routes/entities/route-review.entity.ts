import { Column, Entity, PrimaryColumn } from 'typeorm'

export enum ReviewDecision {
  APROBADA = 'APROBADA',
  RECHAZADA = 'RECHAZADA',
}

export enum RouteReviewStatus {
  PENDIENTE_REVISION = 'PENDIENTE_REVISION',
  APROBADA = 'APROBADA',
  RECHAZADA = 'RECHAZADA',
}

@Entity({ name: 'route_reviews' })
export class RouteReview {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ name: 'route_id', type: 'uuid' })
  routeId!: string

  @Column({ type: 'varchar', length: 20 })
  decision!: ReviewDecision

  @Column({ type: 'text', nullable: true })
  observations!: string | null

  @Column({ name: 'reviewed_at', type: 'timestamptz' })
  reviewedAt!: Date

  @Column({ name: 'reviewer_sub', type: 'varchar', length: 255 })
  reviewerSub!: string

  @Column({
    name: 'reviewer_username',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  reviewerUsername!: string | null

  @Column({ name: 'reviewer_roles', type: 'text', array: true })
  reviewerRoles!: string[]

  @Column({ name: 'correlation_id', type: 'varchar', length: 100 })
  correlationId!: string
}
