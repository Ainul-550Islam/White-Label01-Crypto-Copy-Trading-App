// # Responsibility: defines validated request data for the Batch 04 API capability.
// # Validates explicit policy acceptance and withdrawal requests without permitting arbitrary document versions.
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { REQUIRED_POLICIES, type PolicyDocument } from '../policy-acceptance.service';

export class PolicyAcceptanceDto {
  @IsIn(REQUIRED_POLICIES)
  document!: PolicyDocument;

  @IsString()
  @MaxLength(64)
  version!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contentHash!: string;
}

export class PolicyWithdrawalDto {
  @IsIn(REQUIRED_POLICIES)
  document!: PolicyDocument;
}
