variable "project_name" {
  type    = string
  default = "gs-mobile"
}

variable "environment" {
  type = string
}

variable "uploads_retention_days" {
  description = "Number of days after which raw uploads are deleted"
  type        = number
  default     = 7
}

variable "packshots_ia_transition_days" {
  description = "Days before packshots transition to S3 IA"
  type        = number
  default     = 30
}
