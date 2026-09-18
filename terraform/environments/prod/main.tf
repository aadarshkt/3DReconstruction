terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ClaimSpace"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# --- Cloud Identity Secrets in AWS SSM Parameter Store ---
resource "aws_ssm_parameter" "google_client_id" {
  name        = "/claimspace/${var.environment}/GOOGLE_CLIENT_ID"
  description = "Google OAuth 2.0 Web Client ID"
  type        = "String"
  value       = var.google_client_id
}

resource "aws_ssm_parameter" "google_client_secret" {
  name        = "/claimspace/${var.environment}/GOOGLE_CLIENT_SECRET"
  description = "Google OAuth 2.0 Client Secret"
  type        = "SecureString"
  value       = var.google_client_secret
}

resource "aws_ssm_parameter" "jwt_secret_key" {
  name        = "/claimspace/${var.environment}/JWT_SECRET_KEY"
  description = "Cryptographic signing key for ClaimSpace user JWT tokens"
  type        = "SecureString"
  value       = var.jwt_secret_key
}

# --- Module: Networking (VPC) ---
module "vpc" {
  source      = "../../modules/vpc"
  environment = var.environment
}

# --- Module: Security & IAM ---
module "security" {
  source      = "../../modules/security"
  environment = var.environment
  vpc_id      = module.vpc.vpc_id
}

# --- Module: Database (Amazon RDS PostgreSQL) ---
module "database" {
  source                = "../../modules/database"
  environment           = var.environment
  private_subnet_ids    = module.vpc.private_subnet_ids
  rds_security_group_id = module.security.rds_security_group_id
}

# --- Module: Container Registries (Amazon ECR) ---
module "ecr" {
  source      = "../../modules/ecr"
  environment = var.environment
}

# --- Module: Edge Ingress (Application Load Balancer) ---
module "alb" {
  source                = "../../modules/alb"
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  public_subnet_ids     = module.vpc.public_subnet_ids
  alb_security_group_id = module.security.alb_security_group_id
}

# --- Module: Compute Cluster (Amazon ECS Fargate) ---
module "ecs_cluster" {
  source      = "../../modules/ecs_cluster"
  environment = var.environment
}

# --- Module: Lightweight Microservices (Fargate) ---
module "ecs_services_lightweight" {
  source                = "../../modules/ecs_services_lightweight"
  environment           = var.environment
  aws_region            = var.aws_region
  cluster_id            = module.ecs_cluster.cluster_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  ecs_security_group_id = module.security.ecs_security_group_id
  execution_role_arn    = module.security.ecs_execution_role_arn
  task_role_arn         = module.security.ecs_task_role_arn
  alb_dns_name          = module.alb.alb_dns_name

  frontend_image     = "${module.ecr.frontend_repository_url}:latest"
  auth_service_image = "${module.ecr.auth_service_repository_url}:latest"
  tour_service_image = "${module.ecr.tour_service_repository_url}:latest"

  tg_frontend_arn     = module.alb.tg_frontend_arn
  tg_auth_service_arn = module.alb.tg_auth_service_arn
  tg_tour_service_arn = module.alb.tg_tour_service_arn

  depends_on = [
    module.database,
    aws_ssm_parameter.google_client_id,
    aws_ssm_parameter.google_client_secret,
    aws_ssm_parameter.jwt_secret_key
  ]
}
