module "dynamodb" {
  source = "../../modules/dynamodb"

  project_name = var.project_name
  environment  = var.environment
}

module "s3" {
  source = "../../modules/s3"

  project_name           = var.project_name
  environment            = var.environment
  uploads_retention_days = var.uploads_retention_days
}

module "secrets" {
  source = "../../modules/secrets"

  project_name = var.project_name
  environment  = var.environment
}

module "lambda" {
  source = "../../modules/lambda"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  memory_size = var.lambda_memory_size
  timeout     = var.lambda_timeout

  dynamodb_oauth_state_name    = module.dynamodb.oauth_state_table_name
  dynamodb_oauth_state_arn     = module.dynamodb.oauth_state_table_arn
  dynamodb_oauth_sessions_name = module.dynamodb.oauth_sessions_table_name
  dynamodb_oauth_sessions_arn  = module.dynamodb.oauth_sessions_table_arn

  s3_uploads_bucket_name   = module.s3.uploads_bucket_name
  s3_uploads_bucket_arn    = module.s3.uploads_bucket_arn
  s3_packshots_bucket_name = module.s3.packshots_bucket_name
  s3_packshots_bucket_arn  = module.s3.packshots_bucket_arn

  secret_arns                        = module.secrets.all_secret_arns
  secret_gs_oauth_client_id_name     = module.secrets.gs_oauth_client_id_name
  secret_gs_oauth_client_secret_name = module.secrets.gs_oauth_client_secret_name
  secret_gs_oauth_base_url_name      = module.secrets.gs_oauth_base_url_name
  secret_photoroom_api_key_name      = module.secrets.photoroom_api_key_name
  secret_autoretouch_api_key_name    = module.secrets.autoretouch_api_key_name

  public_base_url         = var.public_base_url
  mobile_deep_link_scheme = var.mobile_deep_link_scheme
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  project_name         = var.project_name
  environment          = var.environment
  lambda_function_name = module.lambda.function_name
  lambda_invoke_arn    = module.lambda.invoke_arn
  domain_name          = var.domain_name
}
