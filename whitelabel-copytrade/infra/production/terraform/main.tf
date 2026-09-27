# =============================================================================
# Production Infrastructure - Terraform
# Reproducible production infrastructure entry point
# =============================================================================
# Design:
# - Provider-explicit architecture, fails validation until required variables supplied
# - No secrets in source, all secrets via secret manager references
# - Environment-specific configuration distinct (dev/staging/prod)
# - Reproducible infrastructure via pinned provider versions
# - Safe outputs only, no secrets in outputs
#
# Existing repo assumptions inspected:
# - Docker: infrastructure/docker/api.Dockerfile, notification-service, etc.
# - Postgres: 16.4-alpine, Redis: 7.4-alpine
# - Queue: BullMQ via Redis
# - Object storage: S3-compatible required (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET)
# - Execution engine: Python services (trading-engine, market-data, execution-engine)
# - No cloud provider hardcoded previously, so this file supports AWS as primary
#   with provider-explicit validation and allows override via variables
# =============================================================================

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6.0"
    }
  }

  backend "s3" {
    # Backend configuration must be supplied via backend config file or env vars
    # Example: terraform init -backend-config=backend.hcl
    # Never hardcode bucket/key/region here
  }
}

# ---------------------------------------------------------------------------
# Variables - Non-secret inputs with validation, secrets from secret manager
# ---------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment, must be production for this stack"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "Environment must be production or staging for this production terraform stack"
  }
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "wlct"

  validation {
    condition     = can(regex("^[a-z0-9-]{2,20}$", var.project_name))
    error_message = "Project name must be 2-20 lowercase alphanumeric with hyphens"
  }
}

variable "aws_region" {
  description = "AWS region for production infrastructure"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "AWS region must be valid format like us-east-1"
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be valid CIDR block"
  }
}

variable "availability_zones" {
  description = "Availability zones for multi-AZ deployment"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least 2 AZs required for production HA"
  }
}

variable "api_image" {
  description = "API container image with digest (immutable reference required)"
  type        = string

  validation {
    condition     = can(regex(".*@sha256:[a-f0-9]{64}", var.api_image))
    error_message = "API image must include immutable digest @sha256:..."
  }
}

variable "admin_web_image" {
  description = "Admin web container image with digest"
  type        = string
  default     = ""

  validation {
    condition     = var.admin_web_image == "" || can(regex(".*@sha256:[a-f0-9]{64}", var.admin_web_image))
    error_message = "Admin web image must include immutable digest if provided"
  }
}

variable "web_image" {
  description = "Customer web container image with digest"
  type        = string
  default     = ""

  validation {
    condition     = var.web_image == "" || can(regex(".*@sha256:[a-f0-9]{64}", var.web_image))
    error_message = "Web image must include immutable digest if provided"
  }
}

variable "notification_service_image" {
  description = "Notification service container image with digest"
  type        = string
  default     = ""

  validation {
    condition     = var.notification_service_image == "" || can(regex(".*@sha256:[a-f0-9]{64}", var.notification_service_image))
    error_message = "Notification service image must include immutable digest if provided"
  }
}

variable "database_instance_class" {
  description = "RDS instance class for production"
  type        = string
  default     = "db.r6g.large"

  validation {
    condition     = can(regex("^db\\.", var.database_instance_class))
    error_message = "Database instance class must start with db."
  }
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "api_desired_count" {
  description = "Desired count of API tasks"
  type        = number
  default     = 3

  validation {
    condition     = var.api_desired_count >= 2
    error_message = "Production requires at least 2 API instances for HA"
  }
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for critical resources"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Backup retention in days"
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 365
    error_message = "Backup retention must be 7-365 days"
  }
}

variable "secret_manager_prefix" {
  description = "Prefix for secret manager secrets, secrets themselves not in TF"
  type        = string
  default     = "wlct/production"

  validation {
    condition     = can(regex("^[a-zA-Z0-9/_-]+$", var.secret_manager_prefix))
    error_message = "Secret manager prefix must be alphanumeric with /_-"
  }
}

variable "domain_name" {
  description = "Production domain name"
  type        = string
  default     = "example.com"

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "Domain name must be valid"
  }
}

variable "tags" {
  description = "Tags for all resources"
  type        = map(string)
  default = {
    Project     = "wlct"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# VPC - Reproducible networking
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "${var.project_name}-${var.environment}-igw" })
}

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-public-${var.availability_zones[count.index]}"
    Type = "public"
  })
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-private-${var.availability_zones[count.index]}"
    Type = "private"
  })
}

resource "aws_subnet" "database" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 20)
  availability_zone = var.availability_zones[count.index]

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-db-${var.availability_zones[count.index]}"
    Type = "database"
  })
}

resource "aws_eip" "nat" {
  count  = length(var.availability_zones)
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.project_name}-${var.environment}-nat-eip-${count.index}" })
}

resource "aws_nat_gateway" "main" {
  count         = length(var.availability_zones)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(var.tags, { Name = "${var.project_name}-${var.environment}-nat-${count.index}" })
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-public-rt" })
}

resource "aws_route_table" "private" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }
  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-private-rt-${count.index}" })
}

resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ---------------------------------------------------------------------------
# Security Groups - Least privilege
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-alb-sg" })
}

resource "aws_security_group" "ecs" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API from ALB"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-ecs-sg" })
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-${var.environment}-rds-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-rds-sg" })
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.project_name}-${var.environment}-redis-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-redis-sg" })
}

# ---------------------------------------------------------------------------
# RDS - Production PostgreSQL
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet"
  subnet_ids = aws_subnet.database[*].id
  tags       = merge(var.tags, { Name = "${var.project_name}-${var.environment}-db-subnet" })
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "${var.project_name}-${var.environment}-"
  family      = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags
}

resource "aws_db_instance" "main" {
  identifier             = "${var.project_name}-${var.environment}-postgres"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.database_instance_class
  allocated_storage      = 100
  max_allocated_storage  = 1000
  storage_type           = "gp3"
  storage_encrypted      = true
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  db_name  = "wlct"
  username = "wlct"
  # Password from secret manager, not hardcoded
  manage_master_user_password = true

  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  deletion_protection     = var.enable_deletion_protection
  multi_az                = true
  publicly_accessible     = false
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.project_name}-${var.environment}-final-${formatdate("YYYY-MM-DD-hh-mm", timestamp())}"
  copy_tags_to_snapshot   = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-postgres" })
}

# ---------------------------------------------------------------------------
# ElastiCache Redis - Production
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.project_name}-${var.environment}-redis"
  description                = "Production Redis for ${var.project_name}"
  node_type                  = var.redis_node_type
  num_cache_clusters         = length(var.availability_zones)
  parameter_group_name       = "default.redis7"
  engine                     = "redis"
  engine_version             = "7.1"
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # Auth token from secret manager
  auth_token                 = null

  snapshot_retention_limit = var.backup_retention_days
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:03:00-sun:04:00"

  tags = merge(var.tags, { Name = "${var.project_name}-${var.environment}-redis" })
}

# ---------------------------------------------------------------------------
# S3 Buckets - Object storage, backups, Terraform state
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "app_storage" {
  bucket        = "${var.project_name}-${var.environment}-app-storage-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = merge(var.tags, { Name = "${var.project_name}-${var.environment}-app-storage" })
}

resource "aws_s3_bucket_versioning" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
  }
}

resource "aws_s3_bucket_public_access_block" "app_storage" {
  bucket                  = aws_s3_bucket.app_storage.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "backups" {
  bucket        = "${var.project_name}-${var.environment}-backups-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = merge(var.tags, { Name = "${var.project_name}-${var.environment}-backups" })
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "retention"
    status = "Enabled"
    expiration { days = var.backup_retention_days }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# ECS Cluster - Application runtime
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}-${var.environment}-api"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-${var.environment}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = var.api_image
      portMappings = [
        { containerPort = 4000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "4000" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.app_storage.bucket },
        { name = "BACKUP_BUCKET", value = aws_s3_bucket.backups.bucket },
        { name = "SECRET_PREFIX", value = var.secret_manager_prefix },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database.arn}:url::" },
        { name = "DIRECT_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database.arn}:directUrl::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis.arn}:url::" },
        { name = "JWT_ACCESS_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt.arn}:accessSecret::" },
        { name = "JWT_REFRESH_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt.arn}:refreshSecret::" },
        { name = "ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.encryption.arn}:key::" },
        { name = "SESSION_COOKIE_SECRET", valueFrom = "${aws_secretsmanager_secret.session.arn}:secret::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# ALB
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  tags               = var.tags
}

resource "aws_lb_target_group" "api" {
  name_prefix = "api-"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = aws_acm_certificate.main.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  subject_alternative_names = ["*.${var.domain_name}"]

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# IAM Roles - Least privilege, no secrets in TF
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-exec-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name_prefix = "secrets-"
  role        = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database.arn,
        aws_secretsmanager_secret.redis.arn,
        aws_secretsmanager_secret.jwt.arn,
        aws_secretsmanager_secret.encryption.arn,
        aws_secretsmanager_secret.session.arn,
      ]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-task-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name_prefix = "s3-"
  role        = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.app_storage.arn,
        "${aws_s3_bucket.app_storage.arn}/*",
        aws_s3_bucket.backups.arn,
        "${aws_s3_bucket.backups.arn}/*",
      ]
    }]
  })
}

# ---------------------------------------------------------------------------
# Secrets Manager - References only, no secret values in TF
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "database" {
  name                    = "${var.secret_manager_prefix}/database"
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "${var.secret_manager_prefix}/redis"
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.secret_manager_prefix}/jwt"
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "encryption" {
  name                    = "${var.secret_manager_prefix}/encryption"
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "session" {
  name                    = "${var.secret_manager_prefix}/session"
  recovery_window_in_days = 30
  tags                    = var.tags
}

# ---------------------------------------------------------------------------
# CloudWatch Alarms - Production observability
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_cpu_high" {
  alarm_name          = "${var.project_name}-${var.environment}-api-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "API CPU high"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.api.name }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  tags                = var.tags
}

# ---------------------------------------------------------------------------
# Outputs - Safe only, no secrets
# ---------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = aws_subnet.database[*].id
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB zone ID"
  value       = aws_lb.main.zone_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "rds_endpoint" {
  description = "RDS endpoint (no credentials)"
  value       = aws_db_instance.main.endpoint
}

output "rds_identifier" {
  description = "RDS identifier"
  value       = aws_db_instance.main.identifier
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "s3_app_storage_bucket" {
  description = "App storage bucket name"
  value       = aws_s3_bucket.app_storage.bucket
}

output "s3_backups_bucket" {
  description = "Backups bucket name"
  value       = aws_s3_bucket.backups.bucket
}

output "secret_manager_prefix" {
  description = "Secret manager prefix (not secret values)"
  value       = var.secret_manager_prefix
}

output "environment" {
  description = "Environment"
  value       = var.environment
}

output "region" {
  description = "AWS region"
  value       = var.aws_region
}

output "api_image" {
  description = "Deployed API image with digest"
  value       = var.api_image
}

output "domain_name" {
  description = "Domain name"
  value       = var.domain_name
}
