variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "project_name" {
  type    = string
  default = "gs-mobile"
}

variable "domain_name" {
  description = "Custom domain for the API (leave empty to use the default execute-api URL)"
  type        = string
  default     = "api-staging.mobile.grand-shooting.com"
}

variable "public_base_url" {
  description = "Public base URL used inside the OAuth redirect_uri"
  type        = string
  default     = "https://api-staging.mobile.grand-shooting.com"
}

variable "mobile_deep_link_scheme" {
  type    = string
  default = "gsmobile"
}

variable "uploads_retention_days" {
  type    = number
  default = 7
}

variable "lambda_memory_size" {
  type    = number
  default = 512
}

variable "lambda_timeout" {
  type    = number
  default = 30
}
