output "alb_dns_name" {
  description = "The public DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "application_url" {
  description = "Base HTTP URL to access the ClaimSpace application"
  value       = "http://${module.alb.alb_dns_name}"
}

output "google_oauth_redirect_uri_to_add" {
  description = "Add this exact Redirect URI to your Google Cloud Console OAuth Client"
  value       = "http://${module.alb.alb_dns_name}/auth/callback"
}

output "database_endpoint" {
  description = "Private endpoint of Amazon RDS PostgreSQL"
  value       = module.database.db_endpoint
}

output "ecr_frontend_url" {
  description = "ECR Repository URL for ClaimSpace Frontend"
  value       = module.ecr.frontend_repository_url
}

output "ecr_auth_service_url" {
  description = "ECR Repository URL for ClaimSpace Auth Microservice"
  value       = module.ecr.auth_service_repository_url
}

output "ecr_tour_service_url" {
  description = "ECR Repository URL for ClaimSpace Guided Tour Microservice"
  value       = module.ecr.tour_service_repository_url
}
