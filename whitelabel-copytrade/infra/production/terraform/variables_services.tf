# Non-secret deployment controls for additional ECS services.
variable "web_domain" {
  description = "Customer application hostname"
  type        = string
  default     = "app.example.com"
}

variable "admin_domain" {
  description = "Administrator console hostname"
  type        = string
  default     = "admin.example.com"
}

variable "service_image_tag" {
  description = "Immutable release tag shared by ECR-built service images"
  type        = string
  default     = "release-2026-10-25"
  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.service_image_tag)) && !contains(["latest", "main"], var.service_image_tag)
    error_message = "service_image_tag must be a non-floating immutable release tag"
  }
}

variable "service_desired_counts" {
  description = "Desired task counts for non-API ECS services"
  type        = map(number)
  default = {
    web                  = 2
    admin-web            = 2
    worker               = 2
    notification-service = 2
    trading-engine       = 2
    execution-engine     = 2
    market-data          = 2
  }
  validation {
    condition     = alltrue([for count in values(var.service_desired_counts) : count >= 1])
    error_message = "Every production service must have at least one task"
  }
}

variable "service_autoscaling_bounds" {
  description = "Minimum and maximum task counts for autoscaled services"
  type        = map(object({ min = number, max = number }))
  default = {
    api    = { min = 2, max = 10 }
    web    = { min = 2, max = 8 }
    worker = { min = 2, max = 12 }
  }
  validation {
    condition     = alltrue([for bounds in values(var.service_autoscaling_bounds) : bounds.min >= 1 && bounds.max >= bounds.min])
    error_message = "Autoscaling bounds must satisfy 1 <= min <= max"
  }
}

variable "service_cpu_memory" {
  description = "Fargate CPU units and memory MiB per service"
  type        = map(object({ cpu = number, memory = number }))
  default = {
    web                  = { cpu = 512, memory = 1024 }
    admin-web            = { cpu = 512, memory = 1024 }
    worker               = { cpu = 1024, memory = 2048 }
    notification-service = { cpu = 512, memory = 1024 }
    trading-engine       = { cpu = 1024, memory = 2048 }
    execution-engine     = { cpu = 1024, memory = 2048 }
    market-data          = { cpu = 512, memory = 1024 }
  }
  validation {
    condition = alltrue([for sizing in values(var.service_cpu_memory) :
      contains([256, 512, 1024, 2048, 4096], sizing.cpu) && sizing.memory >= 512 && sizing.memory <= 30720
    ])
    error_message = "Service sizes must be valid Fargate CPU and memory values"
  }
}
