output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "api_custom_domain" {
  value = module.api_gateway.custom_domain
}

output "api_custom_domain_target" {
  value = module.api_gateway.custom_domain_target
}

output "acm_validation_records" {
  value = module.api_gateway.acm_validation_records
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

output "s3_uploads_bucket" {
  value = module.s3.uploads_bucket_name
}

output "s3_packshots_bucket" {
  value = module.s3.packshots_bucket_name
}
