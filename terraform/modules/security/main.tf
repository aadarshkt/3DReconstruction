variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

# --- Application Load Balancer Security Group ---
resource "aws_security_group" "alb" {
  name        = "${var.environment}-claimspace-alb-sg"
  description = "Allow inbound HTTP/HTTPS traffic to ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP Inbound"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS Inbound"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All Outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-claimspace-alb-sg"
    Environment = var.environment
  }
}

# --- ECS Tasks Security Group ---
resource "aws_security_group" "ecs" {
  name        = "${var.environment}-claimspace-ecs-sg"
  description = "Allow inbound traffic from ALB to ECS microservices"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Frontend port 3000 from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Tour service port 8001 from ALB"
    from_port       = 8001
    to_port         = 8001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Auth service port 8002 from ALB"
    from_port       = 8002
    to_port         = 8002
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description = "Self ingress for container-to-container internal networking"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }

  egress {
    description = "All Outbound via NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-claimspace-ecs-sg"
    Environment = var.environment
  }
}

# --- Amazon RDS PostgreSQL Security Group ---
resource "aws_security_group" "rds" {
  name        = "${var.environment}-claimspace-rds-sg"
  description = "Allow PostgreSQL inbound from ECS tasks only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from ECS microservices"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    description = "Outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-claimspace-rds-sg"
    Environment = var.environment
  }
}

# --- IAM Roles for ECS ---
data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution_role" {
  name               = "${var.environment}-claimspace-ecs-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = {
    Name        = "${var.environment}-claimspace-ecs-exec-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_role_policy" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS to fetch SSM parameters and decrypt KMS secrets
resource "aws_iam_role_policy" "ecs_ssm_policy" {
  name = "${var.environment}-claimspace-ssm-decrypt-policy"
  role = aws_iam_role.ecs_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameters",
          "ssm:GetParameter",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:*:*:parameter/claimspace/${var.environment}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task_role" {
  name               = "${var.environment}-claimspace-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = {
    Name        = "${var.environment}-claimspace-ecs-task-role"
    Environment = var.environment
  }
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "ecs_execution_role_arn" {
  value = aws_iam_role.ecs_execution_role.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task_role.arn
}
