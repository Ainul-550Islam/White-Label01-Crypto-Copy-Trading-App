-- # Creates Batch 04 commercial, preference, statement, and policy-acceptance persistence structures.
CREATE TYPE "ProfitShareStatementStatus" AS ENUM ('DRAFT', 'FINALIZED', 'SUPERSEDED');

CREATE TABLE "fee_schedule_versions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "version" INTEGER NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_until" TIMESTAMPTZ(6),
  "management_fee_rate" VARCHAR(64) NOT NULL,
  "profit_share_rate" VARCHAR(64) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "published_by" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_schedule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_schedule_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fee_schedule_versions_publisher_fk" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fee_schedule_versions_effective_range_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "fee_schedule_versions_management_rate_check" CHECK ("management_fee_rate" ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'),
  CONSTRAINT "fee_schedule_versions_profit_rate_check" CHECK ("profit_share_rate" ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$')
);
CREATE UNIQUE INDEX "fee_schedule_versions_tenant_version_key" ON "fee_schedule_versions"("tenant_id", "version");
CREATE INDEX "fee_schedule_versions_tenant_effective_idx" ON "fee_schedule_versions"("tenant_id", "effective_from", "effective_until");

CREATE TABLE "profit_share_statements" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "follower_user_id" UUID NOT NULL,
  "trader_user_id" UUID NOT NULL,
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ProfitShareStatementStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" VARCHAR(3) NOT NULL,
  "gross_profit" VARCHAR(128) NOT NULL,
  "profit_share_amount" VARCHAR(128) NOT NULL,
  "high_water_mark" VARCHAR(128) NOT NULL,
  "rounding_rule" VARCHAR(64) NOT NULL,
  "supersedes_id" UUID,
  "finalized_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profit_share_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_share_statements_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statements_follower_fk" FOREIGN KEY ("follower_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statements_trader_fk" FOREIGN KEY ("trader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statements_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "profit_share_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statements_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "profit_share_statements_version_check" CHECK ("version" > 0),
  CONSTRAINT "profit_share_statements_profit_check" CHECK ("gross_profit" ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$' AND "profit_share_amount" ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' AND "high_water_mark" ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$')
);
CREATE UNIQUE INDEX "profit_share_statement_period_currency_version_key" ON "profit_share_statements"("tenant_id", "follower_user_id", "trader_user_id", "period_start", "period_end", "currency", "version");
CREATE INDEX "profit_share_statements_follower_period_idx" ON "profit_share_statements"("tenant_id", "follower_user_id", "period_start", "period_end", "status");

CREATE TABLE "profit_share_statement_lines" (
  "id" UUID NOT NULL,
  "statement_id" UUID NOT NULL,
  "source_ledger_id" VARCHAR(64) NOT NULL,
  "source_user_id" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "profit_amount" VARCHAR(128) NOT NULL,
  "fee_amount" VARCHAR(128) NOT NULL,
  "posted_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "profit_share_statement_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_share_statement_lines_statement_fk" FOREIGN KEY ("statement_id") REFERENCES "profit_share_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statement_lines_ledger_fk" FOREIGN KEY ("source_ledger_id") REFERENCES "billing_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statement_lines_user_fk" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_share_statement_lines_amount_check" CHECK ("profit_amount" ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$' AND "fee_amount" ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$')
);
CREATE UNIQUE INDEX "profit_share_statement_lines_statement_ledger_key" ON "profit_share_statement_lines"("statement_id", "source_ledger_id");
CREATE INDEX "profit_share_statement_lines_source_posted_idx" ON "profit_share_statement_lines"("source_user_id", "posted_at");

CREATE TABLE "user_preferences" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "locale" VARCHAR(8) NOT NULL DEFAULT 'en',
  "display_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "date_format" VARCHAR(8) NOT NULL DEFAULT 'ISO',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_preferences_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_preferences_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_preferences_locale_check" CHECK ("locale" IN ('en', 'bn')),
  CONSTRAINT "user_preferences_currency_check" CHECK ("display_currency" IN ('BDT', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH')),
  CONSTRAINT "user_preferences_date_format_check" CHECK ("date_format" IN ('ISO', 'DMY', 'MDY'))
);
CREATE UNIQUE INDEX "user_preferences_tenant_user_key" ON "user_preferences"("tenant_id", "user_id");
CREATE INDEX "user_preferences_tenant_user_idx" ON "user_preferences"("tenant_id", "user_id");

CREATE TABLE "policy_acceptances" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "document" VARCHAR(64) NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_acceptances_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "policy_acceptances_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "policy_acceptances_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "policy_acceptances_version_hash_key" ON "policy_acceptances"("tenant_id", "user_id", "document", "version", "content_hash");
CREATE INDEX "policy_acceptances_tenant_user_document_idx" ON "policy_acceptances"("tenant_id", "user_id", "document", "accepted_at");
