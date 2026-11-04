import { Column, Entity, PrimaryColumn } from 'typeorm'
import type { RouteReview } from './route-review.entity'
import type {
  AppliedRouteParameters,
  RoutePlan,
} from '../../route_engine/route-calculator.service'

export const numericColumnTransformer = {
  to: (value: number): number => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
}

@Entity({ name: 'routes' })
export class Route {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt!: Date

  @Column({ type: 'varchar', length: 40 })
  strategy!: string

  @Column({ name: 'algorithm_version', type: 'varchar', length: 20 })
  algorithmVersion!: string

  @Column({ name: 'dataset_version', type: 'varchar', length: 50 })
  datasetVersion!: string

  @Column({ name: 'dataset_hash', type: 'char', length: 64 })
  datasetHash!: string

  @Column({ type: 'jsonb' })
  parameters!: AppliedRouteParameters

  @Column({ type: 'jsonb' })
  result!: RoutePlan

  @Column({
    name: 'total_distance_km',
    type: 'numeric',
    precision: 10,
    scale: 3,
    transformer: numericColumnTransformer,
  })
  totalDistanceKm!: number

  @Column({
    name: 'created_by_sub',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  createdBySub!: string | null

  @Column({
    name: 'created_by_client_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  createdByClientId!: string | null

  @Column({
    name: 'created_by_username',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  createdByUsername!: string | null

  @Column({ name: 'created_by_roles', type: 'text', array: true })
  createdByRoles!: string[]

  review?: RouteReview | null
}
