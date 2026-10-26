// # Responsibility: validates the withdrawal destination payloads strictly, so an unknown field or a malformed address never reaches the policy service.
//
// `forbidNonWhitelisted` is on in the global validation pipe, so a body carrying
// `status: "ACTIVE"` or `activatesAt` is rejected rather than ignored. Those two
// fields are exactly what an attacker holding a session would try to set: the
// cooldown and the lifecycle status are the control, so a client must not be able
// to name them.
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/** Networks the policy service can validate. Kept in sync with its own registry. */
export const WITHDRAWAL_NETWORKS = [
  'ETHEREUM',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
  'TRON',
  'SOLANA',
  'BITCOIN',
] as const;

export type WithdrawalNetwork = (typeof WITHDRAWAL_NETWORKS)[number];

export class CreateWithdrawalDestinationDto {
  @IsIn(WITHDRAWAL_NETWORKS as unknown as string[], {
    message: `network must be one of: ${WITHDRAWAL_NETWORKS.join(', ')}`,
  })
  network!: WithdrawalNetwork;

  /**
   * The address exactly as the user pasted it. Normalisation (case, checksum
   * policy) happens in the service, because the rule differs per chain and a
   * regex here would have to encode all of them.
   */
  @IsString()
  @Length(16, 128, { message: 'address must be between 16 and 128 characters' })
  @Matches(/^[A-Za-z0-9:_-]+$/, {
    message: 'address contains characters no supported network uses',
  })
  address!: string;

  /** Shown to the user later, and the only part of this payload a human reads. */
  @IsString()
  @Length(2, 80, { message: 'label must be between 2 and 80 characters' })
  label!: string;
}

export class RevokeWithdrawalDestinationDto {
  /**
   * Optional operator/customer note. Not required - a revocation must never be
   * blocked by a missing sentence - but recorded in the audit row when present.
   */
  @IsOptional()
  @IsString()
  @Length(0, 200)
  reason?: string;
}
