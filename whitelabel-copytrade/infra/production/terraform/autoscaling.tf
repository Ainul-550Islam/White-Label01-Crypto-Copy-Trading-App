# Autoscale API, web and worker capacity from measured CPU and memory pressure.
locals {
  autoscaled_services = {
    api    = { name = aws_ecs_service.api.name }
    web    = { name = aws_ecs_service.web.name }
    worker = { name = aws_ecs_service.worker.name }
  }
}

resource "aws_appautoscaling_target" "services" {
  for_each           = local.autoscaled_services
  min_capacity       = var.service_autoscaling_bounds[each.key].min
  max_capacity       = var.service_autoscaling_bounds[each.key].max
  resource_id        = "service/${aws_ecs_cluster.main.name}/${each.value.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.autoscaled_services
  name               = "${var.project_name}-${var.environment}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.services[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.services[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.services[each.key].service_namespace
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 180
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

resource "aws_appautoscaling_policy" "memory" {
  for_each           = local.autoscaled_services
  name               = "${var.project_name}-${var.environment}-${each.key}-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.services[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.services[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.services[each.key].service_namespace
  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 180
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageMemoryUtilization" }
  }
}
