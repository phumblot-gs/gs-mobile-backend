variable "project_name" {
  description = "Project name (used as a prefix on all resources)"
  type        = string
  default     = "gs-mobile"
}

variable "environment" {
  description = "Environment (staging | production | development)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "memory_size" {
  description = "Lambda memory (MB)"
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}

# Resource references for IAM policy + env vars
variable "dynamodb_oauth_state_arn" {
  description = "ARN of the OAuth state DynamoDB table"
  type        = string
}

variable "dynamodb_oauth_sessions_arn" {
  description = "ARN of the OAuth sessions DynamoDB table"
  type        = string
}

variable "dynamodb_oauth_state_name" {
  description = "Name of the OAuth state DynamoDB table"
  type        = string
}

variable "dynamodb_oauth_sessions_name" {
  description = "Name of the OAuth sessions DynamoDB table"
  type        = string
}

variable "s3_uploads_bucket_name" {
  description = "Name of the uploads S3 bucket"
  type        = string
}

variable "s3_uploads_bucket_arn" {
  description = "ARN of the uploads S3 bucket"
  type        = string
}

variable "s3_packshots_bucket_name" {
  description = "Name of the packshots S3 bucket"
  type        = string
}

variable "s3_packshots_bucket_arn" {
  description = "ARN of the packshots S3 bucket"
  type        = string
}

variable "secret_arns" {
  description = "ARNs of all Secrets Manager secrets the Lambda may read"
  type        = list(string)
}

variable "secret_gs_oauth_client_id_name" {
  description = "Secret name for GS OAuth client id"
  type        = string
}

variable "secret_gs_oauth_client_secret_name" {
  description = "Secret name for GS OAuth client secret"
  type        = string
}

variable "secret_gs_oauth_base_url_name" {
  description = "Secret name for GS OAuth base URL"
  type        = string
}

variable "secret_photoroom_api_key_name" {
  description = "Secret name for Photoroom API key"
  type        = string
}

variable "secret_autoretouch_api_key_name" {
  description = "Secret name for Autoretouch API key"
  type        = string
}

variable "public_base_url" {
  description = "Public-facing base URL (https://api.mobile.grand-shooting.com)"
  type        = string
}

variable "mobile_deep_link_scheme" {
  description = "Deep link URL scheme of the iOS app"
  type        = string
  default     = "gsmobile"
}
