variable "environment" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "cluster_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

variable "frontend_image" {
  type = string
}

variable "auth_service_image" {
  type = string
}

variable "tour_service_image" {
  type = string
}

variable "tg_frontend_arn" {
  type = string
}

variable "tg_auth_service_arn" {
  type = string
}

variable "tg_tour_service_arn" {
  type = string
}

data "aws_caller_identity" "current" {}

# --- CloudWatch Log Groups (7 days retention to avoid cost) ---
resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.environment}/frontend"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "auth_service" {
  name              = "/ecs/${var.environment}/auth-service"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "tour_service" {
  name              = "/ecs/${var.environment}/tour-service"
  retention_in_days = 7
}

# --- Task Definition: Auth Microservice ---
resource "aws_ecs_task_definition" "auth_service" {
  family                   = "${var.environment}-auth-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "auth-service"
      image     = var.auth_service_image
      essential = true

      portMappings = [
        {
          containerPort = 8002
          hostPort      = 8002
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "SERVICE_PORT", value = "8002" },
        { name = "ALLOW_DEV_LOGIN", value = "false" },
        { name = "FRONTEND_URL", value = "http://${var.alb_dns_name}" }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/claimspace/${var.environment}/DATABASE_URL"
        },
        {
          name      = "JWT_SECRET_KEY"
          valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/claimspace/${var.environment}/JWT_SECRET_KEY"
        },
        {
          name      = "GOOGLE_CLIENT_ID"
          valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/claimspace/${var.environment}/GOOGLE_CLIENT_ID"
        },
        {
          name      = "GOOGLE_CLIENT_SECRET"
          valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/claimspace/${var.environment}/GOOGLE_CLIENT_SECRET"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.auth_service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "auth"
        }
      }
    }
  ])
}

# --- Task Definition: Guided Tour Microservice ---
resource "aws_ecs_task_definition" "tour_service" {
  family                   = "${var.environment}-tour-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "tour-service"
      image     = var.tour_service_image
      essential = true

      portMappings = [
        {
          containerPort = 8001
          hostPort      = 8001
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.tour_service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "tour"
        }
      }
    }
  ])
}

# --- Task Definition: Frontend Microservice ---
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.environment}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = var.frontend_image
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "frontend"
        }
      }
    }
  ])
}

# --- ECS Fargate Services ---
resource "aws_ecs_service" "auth_service" {
  name            = "${var.environment}-claimspace-auth"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.auth_service.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [var.private_subnet_ids[0], var.private_subnet_ids[1]]
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_auth_service_arn
    container_name   = "auth-service"
    container_port   = 8002
  }
}

resource "aws_ecs_service" "tour_service" {
  name            = "${var.environment}-claimspace-tour"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.tour_service.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [var.private_subnet_ids[0], var.private_subnet_ids[1]]
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_tour_service_arn
    container_name   = "tour-service"
    container_port   = 8001
  }
}

resource "aws_ecs_service" "frontend" {
  name            = "${var.environment}-claimspace-frontend"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [var.private_subnet_ids[0], var.private_subnet_ids[1]]
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_frontend_arn
    container_name   = "frontend"
    container_port   = 3000
  }
}
