# Run queue consumers as an independent private ECS service.
resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-${var.environment}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.service_cpu_memory["worker"].cpu)
  memory                   = tostring(var.service_cpu_memory["worker"].memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name             = "worker"
    image            = var.api_image
    essential        = true
    workingDirectory = "/app/apps/api"
    command          = ["node", "dist/worker.js"]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "API_PUBLIC_URL", value = "https://${var.domain_name}/api" },
      { name = "ADMIN_WEB_URL", value = "https://${var.admin_domain}" },
      { name = "PLATFORM_ROOT_DOMAIN", value = var.domain_name },
      { name = "CORS_ORIGINS", value = "https://${var.web_domain},https://${var.admin_domain}" },
      { name = "REDIS_HOST", value = aws_elasticache_replication_group.main.primary_endpoint_address },
      { name = "REDIS_PORT", value = "6379" },
      { name = "REDIS_TLS", value = "true" },
      { name = "DATASET_LOCAL_ROOT", value = "/app/data/datasets" },
      { name = "DATASET_TEMP_ROOT", value = "/app/data/staging" },
      { name = "SWAGGER_ENABLED", value = "false" },
      { name = "TRADING_ENGINE_URL", value = "http://trading-engine.wlct.internal:8001" },
      { name = "EXECUTION_ENGINE_URL", value = "http://execution-engine.wlct.internal:8093" },
      { name = "MARKET_DATA_URL", value = "http://market-data.wlct.internal:8002" },
      { name = "NOTIFICATION_SERVICE_URL", value = "http://notification-service.wlct.internal:8003" },
      { name = "WORKER_ENABLED", value = "true" },
      { name = "QUEUE_RUN_INLINE_WORKERS", value = "true" },
      { name = "WORKER_MEMBERSHIP_MODE", value = "registry" },
      { name = "WORKER_PARTITION_COUNT", value = "8" },
      { name = "EXECUTION_ENABLED", value = "false" },
      { name = "EXCHANGE_SANDBOX_MODE", value = "true" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database.arn}:url::" },
      { name = "DIRECT_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database.arn}:directUrl::" },
      { name = "REDIS_PASSWORD", valueFrom = "${aws_secretsmanager_secret.redis_auth.arn}:password::" },
      { name = "JWT_ACCESS_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt.arn}:accessSecret::" },
      { name = "JWT_REFRESH_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt.arn}:refreshSecret::" },
      { name = "ENCRYPTION_MASTER_KEY_BASE64", valueFrom = "${aws_secretsmanager_secret.encryption.arn}:masterKeyBase64::" },
      { name = "ENCRYPTION_KEY_ID", valueFrom = "${aws_secretsmanager_secret.encryption.arn}:keyId::" },
      { name = "BLIND_INDEX_KEY_BASE64", valueFrom = "${aws_secretsmanager_secret.encryption.arn}:blindIndexKeyBase64::" },
      { name = "DEVELOPER_SECRET_HMAC_KEY", valueFrom = "${aws_secretsmanager_secret.developer.arn}:hmacKey::" },
      { name = "INTERNAL_SERVICE_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:internalServiceToken::" },
      { name = "EXCHANGE_WEBHOOK_SIGNING_SECRET", valueFrom = "${aws_secretsmanager_secret.service.arn}:exchangeWebhookSigningSecret::" },
      { name = "METRICS_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:metricsToken::" },
      { name = "EXECUTION_ENGINE_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:internalServiceToken::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["worker"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"process.exit(0)\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
  tags = var.tags
}

resource "aws_ecs_service" "worker" {
  name                               = "${var.project_name}-${var.environment}-worker"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.worker.arn
  desired_count                      = var.service_desired_counts["worker"]
  launch_type                        = "FARGATE"
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  tags = var.tags
}

resource "aws_ecs_task_definition" "notification_service" {
  family                   = "${var.project_name}-${var.environment}-notification-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.service_cpu_memory["notification-service"].cpu)
  memory                   = tostring(var.service_cpu_memory["notification-service"].memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = "notification-service"
    image        = "${aws_ecr_repository.images["notification-service"].repository_url}:${var.service_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8003, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "NOTIFICATION_SERVICE_HOST", value = "0.0.0.0" },
      { name = "NOTIFICATION_SERVICE_PORT", value = "8003" },
      { name = "REDIS_HOST", value = aws_elasticache_replication_group.main.primary_endpoint_address },
      { name = "REDIS_PORT", value = "6379" },
      { name = "REDIS_TLS", value = "true" },
      { name = "MAIL_FROM_NAME", value = "Copy Trading Platform" },
      { name = "MAIL_FROM_ADDRESS", value = "no-reply@${var.domain_name}" }
    ]
    secrets = [
      { name = "REDIS_PASSWORD", valueFrom = "${aws_secretsmanager_secret.redis_auth.arn}:password::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["notification-service"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "notification"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
  tags = var.tags
}

resource "aws_ecs_service" "notification_service" {
  name                               = "${var.project_name}-${var.environment}-notification-service"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.notification_service.arn
  desired_count                      = var.service_desired_counts["notification-service"]
  launch_type                        = "FARGATE"
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  service_registries {
    registry_arn = aws_service_discovery_service.notification.arn
  }
  tags = var.tags
}
