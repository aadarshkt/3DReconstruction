variable "environment" {
  type = string
}

resource "aws_ecr_repository" "frontend" {
  name                 = "${var.environment}-claimspace-frontend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${var.environment}-claimspace-frontend"
    Environment = var.environment
  }
}

resource "aws_ecr_repository" "auth_service" {
  name                 = "${var.environment}-claimspace-auth-service"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${var.environment}-claimspace-auth-service"
    Environment = var.environment
  }
}

resource "aws_ecr_repository" "tour_service" {
  name                 = "${var.environment}-claimspace-tour-service"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${var.environment}-claimspace-tour-service"
    Environment = var.environment
  }
}

# Keep only the last 10 images to prevent accumulating storage costs
resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "auth_service" {
  repository = aws_ecr_repository.auth_service.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "tour_service" {
  repository = aws_ecr_repository.tour_service.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

output "frontend_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "auth_service_repository_url" {
  value = aws_ecr_repository.auth_service.repository_url
}

output "tour_service_repository_url" {
  value = aws_ecr_repository.tour_service.repository_url
}
