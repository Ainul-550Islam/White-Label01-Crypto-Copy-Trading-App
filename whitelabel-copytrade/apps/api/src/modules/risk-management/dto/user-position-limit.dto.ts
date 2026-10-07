// # Responsibility: validates self-service integer ceilings for user-wide concurrent positions and open orders.

import { IsInt, IsOptional, Max, Min } from 'class-validator';

const MAX_DATABASE_INTEGER = 2_147_483_647;

export class UpdateUserPositionLimitDto {
  /** Null clears the configured ceiling; zero prevents any new reservation. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DATABASE_INTEGER)
  maxConcurrentPositions?: number | null;

  /** Counts active OMS intents and canonical open orders without double counting. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DATABASE_INTEGER)
  maxOpenOrders?: number | null;
}
