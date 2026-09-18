variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

# --- Application Load Balancer ---
resource "aws_lb" "main" {
  name               = "${var.environment}-claimspace-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false

  tags = {
    Name        = "${var.environment}-claimspace-alb"
    Environment = var.environment
  }
}

# --- Target Groups ---
resource "aws_lb_target_group" "frontend" {
  name        = "${var.environment}-tg-frontend"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    port                = "3000"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "${var.environment}-tg-frontend"
    Environment = var.environment
  }
}

resource "aws_lb_target_group" "auth_service" {
  name        = "${var.environment}-tg-auth-service"
  port        = 8002
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/v1/auth/health"
    port                = "8002"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 20
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "${var.environment}-tg-auth-service"
    Environment = var.environment
  }
}

resource "aws_lb_target_group" "tour_service" {
  name        = "${var.environment}-tg-tour-service"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/v1/tour/health"
    port                = "8001"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 20
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "${var.environment}-tg-tour-service"
    Environment = var.environment
  }
}

# --- HTTP Listener (Port 80) ---
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Default action sends unmatched traffic to Next.js frontend
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# Priority 10: Auth Microservice
resource "aws_lb_listener_rule" "auth_rule" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.auth_service.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1/auth/*"]
    }
  }
}

# Priority 20: Guided Tour Microservice
resource "aws_lb_listener_rule" "tour_rule" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tour_service.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1/tour/*"]
    }
  }
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_arn" {
  value = aws_lb.main.arn
}

output "tg_frontend_arn" {
  value = aws_lb_target_group.frontend.arn
}

output "tg_auth_service_arn" {
  value = aws_lb_target_group.auth_service.arn
}

output "tg_tour_service_arn" {
  value = aws_lb_target_group.tour_service.arn
}
