// # Renders platform/tenant/venue/symbol kill-switch toggles with mandatory reason and confirmation
'use client';

import {
  RiskSwitchControls,
  RiskSwitchRowActions,
  type SwitchRow,
} from '@/app/(console)/risk/switch-controls';

export {
  RiskSwitchControls,
  RiskSwitchControls as KillSwitchControls,
  RiskSwitchRowActions,
  type SwitchRow,
};

export type KillSwitchScopeType = 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';

export interface KillSwitchAuditValidation {
  valid: boolean;
  error?: string;
}

export function validateKillSwitchMutationInput(params: {
  scope: KillSwitchScopeType;
  target?: string;
  reason: string;
}): KillSwitchAuditValidation {
  if (!params.reason || params.reason.trim().length < 10) {
    return {
      valid: false,
      error: 'Kill-switch reason must be at least 10 characters for audit compliance.',
    };
  }
  if (params.scope !== 'GLOBAL' && (!params.target || !params.target.trim())) {
    return {
      valid: false,
      error: `Target identifier is required when scope is ${params.scope}.`,
    };
  }
  return { valid: true };
}
