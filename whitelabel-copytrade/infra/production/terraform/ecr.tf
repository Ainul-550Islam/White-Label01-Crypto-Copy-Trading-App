# Provision immutable, scanned repositories for all published WLCT images.
locals {
  ecr_images = toset(["api", "web", "admin-web", "notification-service", "trading-engine", "execution-engine", "market-data", "gateway"])
}

resource "aws_ecr_repository" "images" {
  for_each             = local.ecr_images
  name                 = "${var.project_name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, { Name = "${var.project_name}-${each.key}" })
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the 20 most recent immutable images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
