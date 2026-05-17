variable "project_name" {
  type    = string
  default = "gs-mobile"
}

variable "environment" {
  type = string
}

variable "recovery_window_in_days" {
  description = "Recovery window for deleted secrets"
  type        = number
  default     = 7
}
