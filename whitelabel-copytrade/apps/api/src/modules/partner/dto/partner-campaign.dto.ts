// # Validates referral campaign and payout request payloads
import {
  CreateCampaignDto,
  TransitionCampaignStateDto,
  CreateReferralDto,
  CreateAttributionDto,
  CalculateCommissionDto,
  ReverseCommissionDto,
  CreateSettlementDto,
  RequestPayoutDto,
  TransitionPayoutDto,
} from '../../partners/dto/partner-campaign.dto';

export {
  CreateCampaignDto,
  TransitionCampaignStateDto,
  CreateReferralDto,
  CreateAttributionDto,
  CalculateCommissionDto,
  ReverseCommissionDto,
  CreateSettlementDto,
  RequestPayoutDto,
  TransitionPayoutDto,
};

export interface PartnerReferralCampaignConstraints {
  minCodeLength: number;
  maxCodeLength: number;
  maxAttributionWindowHours: number;
}

export const DEFAULT_PARTNER_CAMPAIGN_CONSTRAINTS: PartnerReferralCampaignConstraints = {
  minCodeLength: 3,
  maxCodeLength: 32,
  maxAttributionWindowHours: 2_160,
};
