/**
 * Database seed.
 *
 * Idempotent by construction: every write is an upsert keyed on a natural
 * unique constraint, so the script can be run repeatedly against the same
 * database (local bootstrap, CI, a fresh staging environment) without creating
 * duplicates or resetting data that an operator has since changed.
 *
 * What it creates:
 *   1. the permission catalogue derived from the shared `Permission` enum;
 *   2. the platform-level system role templates;
 *   3. the platform tenant plus a tenant-scoped copy of the system roles;
 *   4. the feature flag definitions;
 *   5. the platform subscription plan catalogue;
 *   6. the initial super administrator.
 *
 * The super administrator's password is never hardcoded. It is read from
 * SEED_SUPER_ADMIN_PASSWORD; when that variable is absent the script generates
 * a strong random password, prints it once, and never stores it anywhere else.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import {
  BillingInterval,
  PlanAudience,
  Permission,
  RoleScope,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  TenantStatus,
} from '@wlct/shared-types';
import { FEATURE_FLAG_KEYS } from '@wlct/config';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in every required value before seeding.`,
    );
  }
  return value;
}

/**
 * Blind index used for equality lookups on encrypted/­sensitive columns. Must
 * match the implementation in `packages/utils` so the API can find the row.
 */
function blindIndex(value: string): string {
  const key = Buffer.from(requireEnv('BLIND_INDEX_KEY_BASE64'), 'base64');
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

function generatePassword(): string {
  // 32 random bytes rendered base64url: ~192 bits of entropy, no ambiguity.
  return randomBytes(32).toString('base64url');
}

/**
 * Placeholder credentials that must never reach a real database.
 *
 * `.env.example` ships a deliberately obvious value so the file is runnable out
 * of the box, and the most likely operator mistake is copying it to `.env` and
 * never touching it - which would leave a publicly documented password on the
 * super administrator. Seeding stops instead of silently accepting it.
 */
const PLACEHOLDER_PASSWORD_MARKERS = [
  'changeme',
  'change_me',
  'change-me',
  'password',
  'placeholder',
  'secret',
  'admin123',
];

function assertNotPlaceholder(name: string, value: string): void {
  const normalised = value.trim().toLowerCase();
  const looksLikePlaceholder = PLACEHOLDER_PASSWORD_MARKERS.some((marker) =>
    normalised.includes(marker),
  );

  if (looksLikePlaceholder) {
    throw new Error(
      `${name} still holds the placeholder value from .env.example. ` +
        'Set a real password, or unset the variable entirely and the seed will ' +
        'generate a strong one and print it once.',
    );
  }
}

function describePermission(key: string): { resource: string; action: string; description: string } {
  if (key === Permission.ALL) {
    return {
      resource: '*',
      action: '*',
      description: 'Unrestricted access to every resource on the platform.',
    };
  }

  const [resource, action] = key.split(':');
  const readableResource = resource.replace(/_/g, ' ');
  const readableAction = action.replace(/_/g, ' ');

  return {
    resource,
    action,
    description: `Allows the holder to ${readableAction} ${readableResource} records.`,
  };
}

/**
 * Permissions that grant the ability to move money, change authorisation or
 * read regulated data. Flagged so the API can demand re-authentication before
 * they are granted to a role.
 */
const DANGEROUS_PERMISSIONS = new Set<string>([
  Permission.ALL,
  Permission.PLATFORM_MANAGE,
  Permission.PLATFORM_IMPERSONATE,
  Permission.TENANT_DELETE,
  Permission.TENANT_SUSPEND,
  Permission.USER_DELETE,
  Permission.USER_RESET_PASSWORD,
  Permission.USER_ASSIGN_ROLE,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_DELETE,
  Permission.PAYOUT_MANAGE,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.ORDER_MANAGE,
  Permission.KYC_REVIEW,
]);

// -----------------------------------------------------------------------------
// 1. Permission catalogue
// -----------------------------------------------------------------------------

async function seedPermissions(): Promise<Map<string, string>> {
  const keys = Object.values(Permission);
  const ids = new Map<string, string>();

  for (const key of keys) {
    const meta = describePermission(key);

    const permission = await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        resource: meta.resource,
        action: meta.action,
        description: meta.description,
        isDangerous: DANGEROUS_PERMISSIONS.has(key),
      },
      update: {
        resource: meta.resource,
        action: meta.action,
        description: meta.description,
        isDangerous: DANGEROUS_PERMISSIONS.has(key),
      },
      select: { id: true, key: true },
    });

    ids.set(permission.key, permission.id);
  }

  console.log(`  permissions .......... ${ids.size}`);
  return ids;
}

// -----------------------------------------------------------------------------
// 2. Role templates (tenantId = null)
// -----------------------------------------------------------------------------

async function seedRoleTemplates(permissionIds: Map<string, string>): Promise<void> {
  for (const [index, definition] of SYSTEM_ROLE_DEFINITIONS.entries()) {
    // Prisma cannot express `null` inside a compound unique lookup, so the
    // platform-scoped templates (tenantId IS NULL) are matched explicitly.
    const existingTemplate = await prisma.role.findFirst({
      where: { tenantId: null, key: definition.key },
      select: { id: true },
    });

    const role = existingTemplate
      ? await prisma.role.update({
          where: { id: existingTemplate.id },
          data: {
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            priority: (index + 1) * 10,
            deletedAt: null,
          },
          select: { id: true },
        })
      : await prisma.role.create({
          data: {
            tenantId: null,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            isDefault: definition.key === SystemRole.FOLLOWER,
            priority: (index + 1) * 10,
          },
          select: { id: true },
        });

    // Re-project the permission set so template changes propagate on re-seed.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(`  role templates ....... ${SYSTEM_ROLE_DEFINITIONS.length}`);
}

// -----------------------------------------------------------------------------
// 3. Platform tenant + its own copy of the tenant-scoped roles
// -----------------------------------------------------------------------------

async function seedPlatformTenant(permissionIds: Map<string, string>): Promise<string> {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? 'platform';

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      slug,
      name: process.env.APP_NAME ?? 'Copy Trading Platform',
      legalName: null,
      status: TenantStatus.ACTIVE,
      contactEmail: requireEnv('SEED_SUPER_ADMIN_EMAIL'),
      defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
      supportedLocales: (process.env.SUPPORTED_LOCALES ?? 'en,es,ar,bn,tr').split(','),
      defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'USD',
      supportedCurrencies: (process.env.SUPPORTED_CURRENCIES ?? 'USD').split(','),
      timezone: 'UTC',
      branding: {
        create: {
          appName: process.env.APP_NAME ?? 'Copy Trading Platform',
        },
      },
    },
    update: {
      status: TenantStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true },
  });

  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    if (definition.scope !== RoleScope.TENANT) {
      continue;
    }

    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: definition.key } },
      create: {
        tenantId: tenant.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        scope: definition.scope,
        isSystem: true,
        isDefault: definition.key === SystemRole.FOLLOWER,
      },
      update: { name: definition.name, description: definition.description, deletedAt: null },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(`  platform tenant ...... ${slug}`);
  return tenant.id;
}

// -----------------------------------------------------------------------------
// 4. Feature flag definitions
// -----------------------------------------------------------------------------

interface FlagSeed {
  key: string;
  name: string;
  description: string;
  isGlobalDefault: boolean;
}

const FEATURE_FLAG_SEEDS: FlagSeed[] = [
  {
    key: FEATURE_FLAG_KEYS.COPY_TRADING,
    name: 'Copy trading',
    description: 'Followers can mirror a trader strategy. Requires exchange integration.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.SPOT_TRADING,
    name: 'Spot trading',
    description: 'Enables spot markets for the tenant.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.FUTURES_TRADING,
    name: 'Futures trading',
    description: 'Enables derivatives markets. Requires elevated risk controls.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.PAPER_TRADING,
    name: 'Paper trading',
    description: 'Simulated execution against live prices. Never touches an exchange.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.REFERRAL_PROGRAM,
    name: 'Referral programme',
    description: 'Referral codes and reward tracking.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.KYC_REQUIRED,
    name: 'Mandatory KYC',
    description: 'Blocks trading features until identity verification succeeds.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.TWO_FACTOR_MANDATORY,
    name: 'Mandatory two-factor authentication',
    description: 'Every user must enrol in 2FA before using the platform.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.PUBLIC_REGISTRATION,
    name: 'Public registration',
    description: 'Allows self-service sign-up. Disable for invitation-only brands.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.CUSTOM_DOMAIN,
    name: 'Custom domain',
    description: 'Lets the tenant serve the app from its own domain.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.MOBILE_APP,
    name: 'Mobile application',
    description: 'Enables the white-label mobile client for the tenant.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.ADVANCED_ANALYTICS,
    name: 'Advanced analytics',
    description: 'Extended performance reporting and attribution.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.WITHDRAWAL_NOTIFICATIONS,
    name: 'Withdrawal notifications',
    description: 'Alerts users when a withdrawal is detected on a linked account.',
    isGlobalDefault: true,
  },
];

async function seedFeatureFlags(tenantId: string): Promise<void> {
  for (const flag of FEATURE_FLAG_SEEDS) {
    const definition = await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: {
        key: flag.key,
        name: flag.name,
        description: flag.description,
        isGlobalDefault: flag.isGlobalDefault,
        rolloutPercentage: 100,
      },
      update: { name: flag.name, description: flag.description },
      select: { id: true },
    });

    await prisma.tenantFeatureFlag.upsert({
      where: { tenantId_featureFlagId: { tenantId, featureFlagId: definition.id } },
      create: { tenantId, featureFlagId: definition.id, enabled: flag.isGlobalDefault },
      update: {},
    });
  }

  console.log(`  feature flags ........ ${FEATURE_FLAG_SEEDS.length}`);
}

// -----------------------------------------------------------------------------
// 5. Platform plan catalogue
// -----------------------------------------------------------------------------

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  price: string;
  interval: BillingInterval;
  trialDays: number;
  platformFeeBps: number;
  sortOrder: number;
  limits: Record<string, number | boolean | null>;
  features: string[];
}

const PLAN_SEEDS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a new brand validating its audience.',
    price: '149.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 14,
    platformFeeBps: 100,
    sortOrder: 10,
    limits: {
      maxUsers: 250,
      maxTraders: 5,
      maxFollowersPerTrader: 100,
      maxExchangeAccountsPerUser: 1,
      maxCopySubscriptionsPerFollower: 2,
      maxApiRequestsPerMinute: 300,
      websocketConnections: 500,
      customDomain: false,
      whiteLabelMobileApp: false,
      prioritySupport: false,
    },
    features: ['Branded web app', 'Email support', 'Standard analytics'],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For an established brand scaling its trader roster.',
    price: '499.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 14,
    platformFeeBps: 75,
    sortOrder: 20,
    limits: {
      maxUsers: 5000,
      maxTraders: 50,
      maxFollowersPerTrader: 1000,
      maxExchangeAccountsPerUser: 3,
      maxCopySubscriptionsPerFollower: 10,
      maxApiRequestsPerMinute: 1200,
      websocketConnections: 5000,
      customDomain: true,
      whiteLabelMobileApp: true,
      prioritySupport: false,
    },
    features: ['Custom domain', 'White-label mobile app', 'Advanced analytics'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale with dedicated support and compliance tooling.',
    price: '2499.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 0,
    platformFeeBps: 50,
    sortOrder: 30,
    limits: {
      maxUsers: null,
      maxTraders: null,
      maxFollowersPerTrader: null,
      maxExchangeAccountsPerUser: 10,
      maxCopySubscriptionsPerFollower: null,
      maxApiRequestsPerMinute: 6000,
      websocketConnections: 50000,
      customDomain: true,
      whiteLabelMobileApp: true,
      prioritySupport: true,
    },
    features: [
      'Unlimited users and traders',
      'Dedicated success manager',
      'Compliance exports',
      '99.9% uptime SLA',
    ],
  },
];

async function seedPlans(): Promise<void> {
  for (const plan of PLAN_SEEDS) {
    // Platform catalogue plans have `tenantId = null`, which a compound unique
    // lookup cannot express; match them explicitly instead.
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: { tenantId: null, code: plan.code },
      select: { id: true },
    });

    if (existingPlan) {
      await prisma.subscriptionPlan.update({
        where: { id: existingPlan.id },
        data: {
          name: plan.name,
          description: plan.description,
          price: new Prisma.Decimal(plan.price),
          limits: plan.limits as Prisma.InputJsonValue,
          features: plan.features,
          sortOrder: plan.sortOrder,
          deletedAt: null,
        },
      });
    } else {
      await prisma.subscriptionPlan.create({
        data: {
          tenantId: null,
          code: plan.code,
          name: plan.name,
          description: plan.description,
          audience: PlanAudience.TENANT,
          price: new Prisma.Decimal(plan.price),
          currency: 'USD',
          interval: plan.interval,
          trialDays: plan.trialDays,
          platformFeeBps: plan.platformFeeBps,
          performanceFeeBps: 0,
          limits: plan.limits as Prisma.InputJsonValue,
          features: plan.features,
          isActive: true,
          sortOrder: plan.sortOrder,
        },
      });
    }
  }

  console.log(`  subscription plans ... ${PLAN_SEEDS.length}`);
}

// -----------------------------------------------------------------------------
// 6. Super administrator
// -----------------------------------------------------------------------------

async function seedSuperAdmin(tenantId: string): Promise<void> {
  const email = requireEnv('SEED_SUPER_ADMIN_EMAIL').trim().toLowerCase();
  const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (providedPassword) {
    assertNotPlaceholder('SEED_SUPER_ADMIN_PASSWORD', providedPassword);
  }
  const password = providedPassword ?? generatePassword();

  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email } },
    select: { id: true },
  });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 65536),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 4),
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          isPlatformUser: true,
          deletedAt: null,
          lockedUntil: null,
          failedLoginAttempts: 0,
          // An existing administrator keeps their password; re-seeding must not
          // silently reset a credential an operator is already using.
          ...(providedPassword ? { passwordHash, passwordChangedAt: new Date() } : {}),
        },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          tenantId,
          email,
          emailIndex: blindIndex(email),
          passwordHash,
          status: 'ACTIVE',
          isPlatformUser: true,
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
          profile: {
            create: {
              firstName: 'Platform',
              lastName: 'Administrator',
              displayName: 'Platform Administrator',
              locale: process.env.DEFAULT_LOCALE ?? 'en',
              preferredCurrency: process.env.DEFAULT_CURRENCY ?? 'USD',
              timezone: 'UTC',
            },
          },
        },
        select: { id: true },
      });

  const superAdminRole = await prisma.role.findFirst({
    where: { tenantId: null, key: SystemRole.SUPER_ADMIN },
    select: { id: true },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      create: { userId: user.id, roleId: superAdminRole.id, tenantId },
      update: {},
    });
  }

  console.log(`  super administrator .. ${email}`);

  if (!existing && !providedPassword) {
    console.log('');
    console.log('  ----------------------------------------------------------------');
    console.log('  A password was generated for the super administrator.');
    console.log('  It is shown once and is NOT stored anywhere in plaintext.');
    console.log('');
    console.log(`      email:    ${email}`);
    console.log(`      password: ${password}`);
    console.log('');
    console.log('  Store it in your password manager and rotate it after first use.');
    console.log('  ----------------------------------------------------------------');
    console.log('');
  }
}

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding database...');

  const permissionIds = await seedPermissions();
  await seedRoleTemplates(permissionIds);
  const tenantId = await seedPlatformTenant(permissionIds);
  await seedFeatureFlags(tenantId);
  await seedPlans();
  await seedSuperAdmin(tenantId);

  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
