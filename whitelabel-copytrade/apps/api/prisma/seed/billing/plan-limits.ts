/**
 * Plan Limits Seed Data
 * 
 * This file contains seed data for plan limits.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedPlanLimits() {
  console.log('Seeding plan limits...');

  const limits = [
    // Free Plan Limits
    { planId: 'plan-free', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 1, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-free', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 10, unit: 'orders', hardLimit: true },
    { planId: 'plan-free', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 1000, unit: 'USD', hardLimit: true },

    // Basic Plan Limits
    { planId: 'plan-basic', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 3, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-basic', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 2, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-basic', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 50, unit: 'orders', hardLimit: true },
    { planId: 'plan-basic', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 10000, unit: 'USD', hardLimit: true },
    { planId: 'plan-basic', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 3, unit: 'traders', hardLimit: true },

    // Standard Plan Limits
    { planId: 'plan-standard', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 10, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-standard', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 5, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-standard', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 200, unit: 'orders', hardLimit: true },
    { planId: 'plan-standard', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 100000, unit: 'USD', hardLimit: true },
    { planId: 'plan-standard', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 10, unit: 'traders', hardLimit: true },
    { planId: 'plan-standard', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: 5, unit: 'strategies', hardLimit: true },
    { planId: 'plan-standard', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: 100, unit: 'req/min', hardLimit: true },

    // Premium Plan Limits
    { planId: 'plan-premium', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 100, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-premium', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 20, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-premium', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 1000, unit: 'orders', hardLimit: true },
    { planId: 'plan-premium', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 1000000, unit: 'USD', hardLimit: true },
    { planId: 'plan-premium', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 50, unit: 'traders', hardLimit: true },
    { planId: 'plan-premium', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: 20, unit: 'strategies', hardLimit: true },
    { planId: 'plan-premium', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: 1000, unit: 'req/min', hardLimit: true },
    { planId: 'plan-premium', key: 'max_storage_mb', name: 'Storage', description: 'Storage space', value: 5000, unit: 'MB', hardLimit: true },

    // Enterprise Plan Limits (unlimited)
    { planId: 'plan-enterprise', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: -1, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: -1, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: -1, unit: 'orders', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: -1, unit: 'USD', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: -1, unit: 'traders', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: -1, unit: 'strategies', hardLimit: true },
    { planId: 'plan-enterprise', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: -1, unit: 'req/min', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_storage_mb', name: 'Storage', description: 'Storage space', value: -1, unit: 'MB', hardLimit: true },
  ];

  for (const limit of limits) {
    await prisma.planLimit.upsert({
      where: {
        planId_key: {
          planId: limit.planId,
          key: limit.key,
        },
      },
      update: limit,
      create: limit,
    });
  }

  console.log(`Seeded ${limits.length} plan limits`);
}