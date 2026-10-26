# Deploy customer and administrator web workloads behind the existing HTTPS ALB.
locals {
  web_apps = {
    web = {
      port        = 3001
      domain      = var.web_domain
      health_path = "/login"
      environment = {
        NODE_ENV     = "production"
        PORT         = "3001"
        HOSTNAME     = "0.0.0.0"
        API_BASE_URL = "https://api.${var.domain_name}/api"
      }
      secrets = {
        SESSION_COOKIE_SECRET = "${aws_secretsmanager_secret.web_session.arn}:secret::"
      }
    }
    admin-web = {
      port        = 3000
      domain      = var.admin_domain
      health_path = "/login"
      environment = {
        NODE_ENV          = "production"
        PORT              = "3000"
        HOSTNAME          = "0.0.0.0"
        API_BASE_URL      = "https://api.${var.domain_name}/api"
        ADMIN_TENANT_SLUG = "platform"
      }
      secrets = {
        SESSION_COOKIE_SECRET = "${aws_secretsmanager_secret.session.arn}:secret::"
      }
    }
  }
}

# Customer-browser and administrator-browser sessions use separate signing keys.
resource "aws_secretsmanager_secret" "web_session" {
  name                    = "${var.secret_manager_prefix}/web-session"
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_iam_role_policy" "web_session_secret_read" {
  name = "${var.project_name}-${var.environment}-web-session-secret-read"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.web_session.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(["web", "admin-web", "worker", "notification-service", "trading-engine", "execution-engine", "market-data"])
  name              = "/ecs/${var.project_name}-${var.environment}-${each.key}"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_lb_target_group" "web_apps" {
  for_each    = local.web_apps
  name        = substr("${var.project_name}-${var.environment}-${each.key}", 0, 32)
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = each.value.health_path
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = var.tags
}

resource "aws_lb_listener_rule" "web_apps" {
  for_each     = local.web_apps
  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "web" ? 20 : 21

  condition {
    host_header { values = [each.value.domain] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web_apps[each.key].arn
  }
}

resource "aws_ecs_task_definition" "web_apps" {
  for_each                 = local.web_apps
  family                   = "${var.project_name}-${var.environment}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.service_cpu_memory[each.key].cpu)
  memory                   = tostring(var.service_cpu_memory[each.key].memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = each.key
    image        = "${aws_ecr_repository.images[each.key].repository_url}:${var.service_image_tag}"
    essential    = true
    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }]
    environment = [
      for name, value in each.value.environment : { name = name, value = value }
    ]
    secrets = [
      for name, value in each.value.secrets : { name = name, valueFrom = value }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = each.key
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${each.value.port}${each.value.health_path}').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
  tags = var.tags
}

resource "aws_ecs_service" "web" {
  name                               = "${var.project_name}-${var.environment}-web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web_apps["web"].arn
  desired_count                      = var.service_desired_counts["web"]
  launch_type                        = "FARGATE"
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
  health_check_grace_period_seconds  = 60
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web_apps["web"].arn
    container_name   = "web"
    container_port   = local.web_apps["web"].port
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  tags = var.tags
}

resource "aws_ecs_service" "admin_web" {
  name                               = "${var.project_name}-${var.environment}-admin-web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web_apps["admin-web"].arn
  desired_count                      = var.service_desired_counts["admin-web"]
  launch_type                        = "FARGATE"
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
  health_check_grace_period_seconds  = 60
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web_apps["admin-web"].arn
    container_name   = "admin-web"
    container_port   = local.web_apps["admin-web"].port
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  tags = var.tags
}
