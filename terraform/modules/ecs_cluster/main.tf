variable "environment" {
  type = string
}

resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-claimspace-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # Keep disabled to avoid extra CloudWatch metric fees
  }

  tags = {
    Name        = "${var.environment}-claimspace-cluster"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

output "cluster_id" {
  value = aws_ecs_cluster.main.id
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}
