variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "project_name" {
  type    = string
  default = "gs-mobile"
}

variable "domain_name" {
  description = "Custom domain for the API"
  type        = string
  default     = "api.mobile.grand-shooting.com"
}

variable "public_base_url" {
  type    = string
  default = "https://api.mobile.grand-shooting.com"
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
  default = 1024
}

variable "lambda_timeout" {
  type    = number
  default = 30
}
