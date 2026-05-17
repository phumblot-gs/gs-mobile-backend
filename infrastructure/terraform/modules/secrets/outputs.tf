output "gs_oauth_client_id_name" {
  value = aws_secretsmanager_secret.gs_oauth_client_id.name
}

output "gs_oauth_client_id_arn" {
  value = aws_secretsmanager_secret.gs_oauth_client_id.arn
}

output "gs_oauth_client_secret_name" {
  value = aws_secretsmanager_secret.gs_oauth_client_secret.name
}

output "gs_oauth_client_secret_arn" {
  value = aws_secretsmanager_secret.gs_oauth_client_secret.arn
}

output "gs_oauth_base_url_name" {
  value = aws_secretsmanager_secret.gs_oauth_base_url.name
}

output "gs_oauth_base_url_arn" {
  value = aws_secretsmanager_secret.gs_oauth_base_url.arn
}

output "photoroom_api_key_name" {
  value = aws_secretsmanager_secret.photoroom_api_key.name
}

output "photoroom_api_key_arn" {
  value = aws_secretsmanager_secret.photoroom_api_key.arn
}

output "autoretouch_api_key_name" {
  value = aws_secretsmanager_secret.autoretouch_api_key.name
}

output "autoretouch_api_key_arn" {
  value = aws_secretsmanager_secret.autoretouch_api_key.arn
}

output "all_secret_arns" {
  description = "All secret ARNs (for IAM policy)"
  value = [
    aws_secretsmanager_secret.gs_oauth_client_id.arn,
    aws_secretsmanager_secret.gs_oauth_client_secret.arn,
    aws_secretsmanager_secret.gs_oauth_base_url.arn,
    aws_secretsmanager_secret.photoroom_api_key.arn,
    aws_secretsmanager_secret.autoretouch_api_key.arn
  ]
}
