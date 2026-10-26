# Publish outputs for newly created image repositories and private service discovery.
output "ecr_repository_urls" {
  description = "ECR registry URLs for published service images"
  value       = { for name, repository in aws_ecr_repository.images : name => repository.repository_url }
}

output "service_discovery_namespace" {
  description = "Private service discovery namespace"
  value       = aws_service_discovery_private_dns_namespace.main.name
}
