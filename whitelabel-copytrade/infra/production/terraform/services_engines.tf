# Deploy the Python engines in private subnets with service-specific contracts.
locals {
  internal_engines = {
    "trading-engine" = {
      port    = 8001
      image   = "trading-engine"
      command = ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "TRADING_ENGINE_HOST", value = "0.0.0.0" },
        { name = "TRADING_ENGINE_PORT", value = "8001" },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.main.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" },
        { name = "QUEUE_PREFIX", value = "wlct" },
        { name = "EXECUTION_ENABLED", value = "false" },
        { name = "EXCHANGE_SANDBOX_MODE", value = "true" },
        { name = "OBSERVABILITY_ENABLED", value = "true" }
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database.arn}:url::" },
        { name = "REDIS_PASSWORD", valueFrom = "${aws_secretsmanager_secret.redis_auth.arn}:password::" },
        { name = "INTERNAL_SERVICE_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:internalServiceToken::" }
      ]
    }
    "execution-engine" = {
      port    = 8093
      image   = "execution-engine"
      command = ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8093"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "SERVICE_PORT", value = "8093" },
        { name = "EXECUTION_ENGINE_HOST", value = "0.0.0.0" },
        { name = "EXECUTION_MODE", value = "simulated" },
        { name = "EXECUTION_DRY_RUN", value = "true" },
        { name = "OBSERVABILITY_ENABLED", value = "true" }
      ]
      secrets = [
        { name = "EXECUTION_INTERNAL_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:internalServiceToken::" }
      ]
    }
    "market-data" = {
      port    = 8002
      image   = "market-data"
      command = ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "MARKET_DATA_HOST", value = "0.0.0.0" },
        { name = "MARKET_DATA_PORT", value = "8002" },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.main.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" },
        { name = "OBSERVABILITY_ENABLED", value = "true" }
      ]
      secrets = [
        { name = "REDIS_PASSWORD", valueFrom = "${aws_secretsmanager_secret.redis_auth.arn}:password::" },
        { name = "INTERNAL_SERVICE_TOKEN", valueFrom = "${aws_secretsmanager_secret.service.arn}:internalServiceToken::" }
      ]
    }
  }
}

resource "aws_ecs_task_definition" "engines" {
  for_each                 = local.internal_engines
  family                   = "${var.project_name}-${var.environment}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.service_cpu_memory[each.key].cpu)
  memory                   = tostring(var.service_cpu_memory[each.key].memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = each.key
    image        = "${aws_ecr_repository.images[each.value.image].repository_url}:${var.service_image_tag}"
    essential    = true
    command      = each.value.command
    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }]
    environment  = each.value.environment
    secrets      = each.value.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = each.key
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "python -c \\\"import urllib.request; urllib.request.urlopen('http://127.0.0.1:${each.value.port}/health', timeout=3)\\\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
  tags = var.tags
}

resource "aws_ecs_service" "trading_engine" {
  name                               = "${var.project_name}-${var.environment}-trading-engine"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.engines["trading-engine"].arn
  desired_count                      = var.service_desired_counts["trading-engine"]
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
  service_registries { registry_arn = aws_service_discovery_service.engines["trading-engine"].arn }
  tags = var.tags
}

resource "aws_ecs_service" "execution_engine" {
  name                               = "${var.project_name}-${var.environment}-execution-engine"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.engines["execution-engine"].arn
  desired_count                      = var.service_desired_counts["execution-engine"]
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
  service_registries { registry_arn = aws_service_discovery_service.engines["execution-engine"].arn }
  tags = var.tags
}

resource "aws_ecs_service" "market_data" {
  name                               = "${var.project_name}-${var.environment}-market-data"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.engines["market-data"].arn
  desired_count                      = var.service_desired_counts["market-data"]
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
  service_registries { registry_arn = aws_service_discovery_service.engines["market-data"].arn }
  tags = var.tags
}
