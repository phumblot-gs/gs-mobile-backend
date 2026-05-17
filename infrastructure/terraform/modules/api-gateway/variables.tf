variable "project_name" {
  type    = string
  default = "gs-mobile"
}

variable "environment" {
  type = string
}

variable "lambda_function_name" {
  type = string
}

variable "lambda_invoke_arn" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "domain_name" {
  description = "Custom domain (e.g. api.mobile.grand-shooting.com). Leave empty to skip."
  type        = string
  default     = ""
}
