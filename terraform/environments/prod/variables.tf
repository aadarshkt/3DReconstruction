variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "AWS deployment region"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Target deployment environment"
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth 2.0 Web Client ID"
  sensitive   = false
}

variable "google_client_secret" {
  type        = string
  description = "Google OAuth 2.0 Client Secret"
  sensitive   = true
}

variable "jwt_secret_key" {
  type        = string
  description = "32-byte secret key for signing user JWT tokens"
  sensitive   = true
}

variable "enable_heavy_pipeline" {
  type        = bool
  default     = false
  description = "Flag to deploy Profile B (Heavy Reconstruction with EC2 GPU worker, Redis, EFS)"
}
