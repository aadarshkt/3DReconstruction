variable "environment" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "rds_security_group_id" {
  type = string
}

resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "rds" {
  name        = "${var.environment}-claimspace-rds-subnet-group"
  subnet_ids  = var.private_subnet_ids
  description = "Private subnet group for ClaimSpace RDS"

  tags = {
    Name        = "${var.environment}-claimspace-rds-subnet-group"
    Environment = var.environment
  }
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${var.environment}-claimspace-postgres15"
  family = "postgres15"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  tags = {
    Name        = "${var.environment}-claimspace-pg-params"
    Environment = var.environment
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.environment}-claimspace-db"
  allocated_storage      = 20
  max_allocated_storage  = 50
  storage_type           = "gp3"
  engine                 = "postgres"
  engine_version         = "15.13"
  instance_class         = "db.t4g.micro"
  db_name                = "claimspace"
  username               = "claimadmin"
  password               = random_password.db_password.result
  parameter_group_name   = aws_db_parameter_group.postgres.name
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  vpc_security_group_ids = [var.rds_security_group_id]
  publicly_accessible    = false
  skip_final_snapshot    = true
  deletion_protection    = false

  tags = {
    Name        = "${var.environment}-claimspace-postgres"
    Environment = var.environment
  }
}

# Automatically store the asyncpg connection string in SSM Parameter Store
resource "aws_ssm_parameter" "database_url" {
  name        = "/claimspace/${var.environment}/DATABASE_URL"
  description = "AsyncPG connection string for ClaimSpace RDS PostgreSQL"
  type        = "SecureString"
  value       = "postgresql+asyncpg://${aws_db_instance.postgres.username}:${random_password.db_password.result}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}"

  tags = {
    Environment = var.environment
  }
}

output "db_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "db_name" {
  value = aws_db_instance.postgres.db_name
}

output "db_user" {
  value = aws_db_instance.postgres.username
}

output "database_url_ssm_arn" {
  value = aws_ssm_parameter.database_url.arn
}
