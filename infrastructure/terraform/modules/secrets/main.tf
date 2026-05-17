# Secrets Manager entries for the mobile backend.
#
# We provision the SECRET resources here so the Lambda can be granted IAM
# access to them, but we deliberately DO NOT manage the secret value via
# Terraform — `secret_string` is set manually via the AWS Console or the
# `scripts/seed-secrets.sh` helper. The lifecycle block prevents Terraform
# from clobbering the value on subsequent applies.

locals {
  secret_names = {
    gs_oauth_client_id     = "${var.project_name}/${var.environment}/gs-oauth-client-id"
    gs_oauth_client_secret = "${var.project_name}/${var.environment}/gs-oauth-client-secret"
    gs_oauth_base_url      = "${var.project_name}/${var.environment}/gs-oauth-base-url"
    photoroom_api_key      = "${var.project_name}/${var.environment}/photoroom-api-key"
    autoretouch_api_key    = "${var.project_name}/${var.environment}/autoretouch-api-key"
  }
}

resource "aws_secretsmanager_secret" "gs_oauth_client_id" {
  name                    = local.secret_names.gs_oauth_client_id
  description             = "Grand Shooting OAuth client ID for the mobile app"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "gs_oauth_client_id" {
  secret_id     = aws_secretsmanager_secret.gs_oauth_client_id.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "gs_oauth_client_secret" {
  name                    = local.secret_names.gs_oauth_client_secret
  description             = "Grand Shooting OAuth client secret for the mobile app"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "gs_oauth_client_secret" {
  secret_id     = aws_secretsmanager_secret.gs_oauth_client_secret.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "gs_oauth_base_url" {
  name                    = local.secret_names.gs_oauth_base_url
  description             = "Grand Shooting OAuth base URL (e.g. https://api-19.grand-shooting.com)"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "gs_oauth_base_url" {
  secret_id     = aws_secretsmanager_secret.gs_oauth_base_url.id
  secret_string = "https://api-19.grand-shooting.com"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "photoroom_api_key" {
  name                    = local.secret_names.photoroom_api_key
  description             = "Photoroom API key"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "photoroom_api_key" {
  secret_id     = aws_secretsmanager_secret.photoroom_api_key.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "autoretouch_api_key" {
  name                    = local.secret_names.autoretouch_api_key
  description             = "Autoretouch API key"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "autoretouch_api_key" {
  secret_id     = aws_secretsmanager_secret.autoretouch_api_key.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
