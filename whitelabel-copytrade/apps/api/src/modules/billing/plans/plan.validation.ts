/**
 * Plan Validation - Validation logic for billing plans
 * 
 * This module handles validation of plan data including
 * creation, updates, and business rule validation.
 */

import { CreatePlanRequest, UpdatePlanRequest, PlanTier, BillingInterval } from './plan.types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateCreatePlan(data: CreatePlanRequest): ValidationResult {
  const errors: string[] = [];

  // Name validation
  if (!data.name || data.name.trim().length === 0) {
    errors.push('Plan name is required');
  } else if (data.name.length > 100) {
    errors.push('Plan name must be 100 characters or less');
  }

  // Slug validation
  if (!data.slug || data.slug.trim().length === 0) {
    errors.push('Plan slug is required');
  } else if (!/^[a-z0-9-]+$/.test(data.slug)) {
    errors.push('Plan slug must contain only lowercase letters, numbers, and hyphens');
  } else if (data.slug.length > 50) {
    errors.push('Plan slug must be 50 characters or less');
  }

  // Description validation
  if (!data.description || data.description.trim().length === 0) {
    errors.push('Plan description is required');
  } else if (data.description.length > 500) {
    errors.push('Plan description must be 500 characters or less');
  }

  // Tier validation
  if (!data.tier || !Object.values(PlanTier).includes(data.tier)) {
    errors.push('Valid plan tier is required');
  }

  // Price validation
  if (!data.price) {
    errors.push('Plan price is required');
  } else {
    if (typeof data.price.amount !== 'number' || data.price.amount < 0) {
      errors.push('Price amount must be a non-negative number');
    }

    if (!data.price.currency || data.price.currency.length !== 3) {
      errors.push('Valid 3-letter currency code is required');
    }

    if (!data.price.interval || !Object.values(BillingInterval).includes(data.price.interval)) {
      errors.push('Valid billing interval is required');
    }

    if (data.price.trialDays !== undefined) {
      if (typeof data.price.trialDays !== 'number' || data.price.trialDays < 0) {
        errors.push('Trial days must be a non-negative number');
      }
      if (data.price.trialDays > 90) {
        errors.push('Trial days cannot exceed 90');
      }
    }
  }

  // Features validation
  if (!data.features || !Array.isArray(data.features)) {
    errors.push('Features array is required');
  } else {
    data.features.forEach((feature, index) => {
      if (!feature.key || feature.key.trim().length === 0) {
        errors.push(`Feature ${index + 1}: key is required`);
      }
      if (!feature.name || feature.name.trim().length === 0) {
        errors.push(`Feature ${index + 1}: name is required`);
      }
      if (!feature.description || feature.description.trim().length === 0) {
        errors.push(`Feature ${index + 1}: description is required`);
      }
      if (typeof feature.enabled !== 'boolean') {
        errors.push(`Feature ${index + 1}: enabled must be a boolean`);
      }
      if (feature.limit !== undefined && (typeof feature.limit !== 'number' || feature.limit < 0)) {
        errors.push(`Feature ${index + 1}: limit must be a non-negative number`);
      }
    });

    // Check for duplicate feature keys
    const featureKeys = data.features.map(f => f.key);
    const duplicateKeys = featureKeys.filter((key, index) => featureKeys.indexOf(key) !== index);
    if (duplicateKeys.length > 0) {
      errors.push(`Duplicate feature keys: ${[...new Set(duplicateKeys)].join(', ')}`);
    }
  }

  // Limits validation
  if (!data.limits || !Array.isArray(data.limits)) {
    errors.push('Limits array is required');
  } else {
    data.limits.forEach((limit, index) => {
      if (!limit.key || limit.key.trim().length === 0) {
        errors.push(`Limit ${index + 1}: key is required`);
      }
      if (!limit.name || limit.name.trim().length === 0) {
        errors.push(`Limit ${index + 1}: name is required`);
      }
      if (!limit.description || limit.description.trim().length === 0) {
        errors.push(`Limit ${index + 1}: description is required`);
      }
      if (typeof limit.value !== 'number') {
        errors.push(`Limit ${index + 1}: value must be a number`);
      }
      if (!limit.unit || limit.unit.trim().length === 0) {
        errors.push(`Limit ${index + 1}: unit is required`);
      }
      if (typeof limit.hardLimit !== 'boolean') {
        errors.push(`Limit ${index + 1}: hardLimit must be a boolean`);
      }
    });

    // Check for duplicate limit keys
    const limitKeys = data.limits.map(l => l.key);
    const duplicateKeys = limitKeys.filter((key, index) => limitKeys.indexOf(key) !== index);
    if (duplicateKeys.length > 0) {
      errors.push(`Duplicate limit keys: ${[...new Set(duplicateKeys)].join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateUpdatePlan(data: UpdatePlanRequest): ValidationResult {
  const errors: string[] = [];

  // Name validation (optional)
  if (data.name !== undefined) {
    if (data.name.trim().length === 0) {
      errors.push('Plan name cannot be empty');
    } else if (data.name.length > 100) {
      errors.push('Plan name must be 100 characters or less');
    }
  }

  // Description validation (optional)
  if (data.description !== undefined) {
    if (data.description.trim().length === 0) {
      errors.push('Plan description cannot be empty');
    } else if (data.description.length > 500) {
      errors.push('Plan description must be 500 characters or less');
    }
  }

  // Tier validation (optional)
  if (data.tier !== undefined && !Object.values(PlanTier).includes(data.tier)) {
    errors.push('Valid plan tier is required');
  }

  // Price validation (optional)
  if (data.price !== undefined) {
    if (typeof data.price.amount !== 'number' || data.price.amount < 0) {
      errors.push('Price amount must be a non-negative number');
    }

    if (data.price.currency && data.price.currency.length !== 3) {
      errors.push('Valid 3-letter currency code is required');
    }

    if (data.price.interval && !Object.values(BillingInterval).includes(data.price.interval)) {
      errors.push('Valid billing interval is required');
    }

    if (data.price.trialDays !== undefined) {
      if (typeof data.price.trialDays !== 'number' || data.price.trialDays < 0) {
        errors.push('Trial days must be a non-negative number');
      }
      if (data.price.trialDays > 90) {
        errors.push('Trial days cannot exceed 90');
      }
    }
  }

  // Features validation (optional)
  if (data.features !== undefined) {
    if (!Array.isArray(data.features)) {
      errors.push('Features must be an array');
    } else {
      data.features.forEach((feature, index) => {
        if (!feature.key || feature.key.trim().length === 0) {
          errors.push(`Feature ${index + 1}: key is required`);
        }
        if (!feature.name || feature.name.trim().length === 0) {
          errors.push(`Feature ${index + 1}: name is required`);
        }
        if (typeof feature.enabled !== 'boolean') {
          errors.push(`Feature ${index + 1}: enabled must be a boolean`);
        }
      });
    }
  }

  // Limits validation (optional)
  if (data.limits !== undefined) {
    if (!Array.isArray(data.limits)) {
      errors.push('Limits must be an array');
    } else {
      data.limits.forEach((limit, index) => {
        if (!limit.key || limit.key.trim().length === 0) {
          errors.push(`Limit ${index + 1}: key is required`);
        }
        if (typeof limit.value !== 'number') {
          errors.push(`Limit ${index + 1}: value must be a number`);
        }
        if (typeof limit.hardLimit !== 'boolean') {
          errors.push(`Limit ${index + 1}: hardLimit must be a boolean`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePlanSlug(slug: string): ValidationResult {
  const errors: string[] = [];

  if (!slug || slug.trim().length === 0) {
    errors.push('Slug is required');
  } else if (!/^[a-z0-9-]+$/.test(slug)) {
    errors.push('Slug must contain only lowercase letters, numbers, and hyphens');
  } else if (slug.length > 50) {
    errors.push('Slug must be 50 characters or less');
  } else if (slug.startsWith('-') || slug.endsWith('-')) {
    errors.push('Slug cannot start or end with a hyphen');
  } else if (slug.includes('--')) {
    errors.push('Slug cannot contain consecutive hyphens');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePlanPrice(amount: number, currency: string, interval: string): ValidationResult {
  const errors: string[] = [];

  if (typeof amount !== 'number' || amount < 0) {
    errors.push('Amount must be a non-negative number');
  }

  if (!currency || currency.length !== 3) {
    errors.push('Valid 3-letter currency code is required');
  } else if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push('Currency code must be 3 uppercase letters');
  }

  if (!interval || !Object.values(BillingInterval).includes(interval as BillingInterval)) {
    errors.push('Valid billing interval is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}