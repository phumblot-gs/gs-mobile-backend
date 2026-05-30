output "api_endpoint" {
  description = "Default execute-api endpoint for the HTTP API"
  value       = module.api_gateway.api_endpoint
}

output "api_custom_domain" {
  description = "Custom domain (if configured)"
  value       = module.api_gateway.custom_domain
}

output "api_custom_domain_target" {
  description = "CNAME target for the custom domain (configure DNS to point here)"
  value       = module.api_gateway.custom_domain_target
}

output "acm_validation_records" {
  description = "ACM certificate validation DNS records"
  value       = module.api_gateway.acm_validation_records
}

output "lambda_function_name" {
  value = module.lambda.function_name
}

output "dynamodb_oauth_state_table" {
  value = module.dynamodb.oauth_state_table_name
}

output "dynamodb_oauth_sessions_table" {
  value = module.dynamodb.oauth_sessions_table_name
}

output "dynamodb_account_settings_pointer_table" {
  value = module.dynamodb.account_settings_pointer_table_name
}

output "dynamodb_account_settings_version_table" {
  value = module.dynamodb.account_settings_version_table_name
}

output "dynamodb_account_settings_rate_limit_table" {
  value = module.dynamodb.account_settings_rate_limit_table_name
}

output "s3_uploads_bucket" {
  value = module.s3.uploads_bucket_name
}

output "s3_packshots_bucket" {
  value = module.s3.packshots_bucket_name
}
