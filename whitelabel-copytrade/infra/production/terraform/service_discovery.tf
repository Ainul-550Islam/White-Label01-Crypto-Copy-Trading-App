# Private Cloud Map DNS records used exclusively inside the ECS VPC.
resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "wlct.internal"
  vpc         = aws_vpc.main.id
  description = "Private service discovery for WLCT production workloads"
  tags        = var.tags
}

resource "aws_service_discovery_service" "engines" {
  for_each     = local.internal_engines
  name         = each.key
  namespace_id = aws_service_discovery_private_dns_namespace.main.id
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config { failure_threshold = 1 }
  tags = var.tags
}

resource "aws_service_discovery_service" "notification" {
  name         = "notification-service"
  namespace_id = aws_service_discovery_private_dns_namespace.main.id
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config { failure_threshold = 1 }
  tags = var.tags
}

