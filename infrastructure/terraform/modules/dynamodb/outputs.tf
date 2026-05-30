output "oauth_state_table_name" {
  value = aws_dynamodb_table.oauth_state.name
}

output "oauth_state_table_arn" {
  value = aws_dynamodb_table.oauth_state.arn
}

output "oauth_sessions_table_name" {
  value = aws_dynamodb_table.oauth_sessions.name
}

output "oauth_sessions_table_arn" {
  value = aws_dynamodb_table.oauth_sessions.arn
}

output "account_settings_pointer_table_name" {
  value = aws_dynamodb_table.account_settings_pointer.name
}

output "account_settings_pointer_table_arn" {
  value = aws_dynamodb_table.account_settings_pointer.arn
}

output "account_settings_version_table_name" {
  value = aws_dynamodb_table.account_settings_version.name
}

output "account_settings_version_table_arn" {
  value = aws_dynamodb_table.account_settings_version.arn
}

output "account_settings_rate_limit_table_name" {
  value = aws_dynamodb_table.account_settings_rate_limit.name
}

output "account_settings_rate_limit_table_arn" {
  value = aws_dynamodb_table.account_settings_rate_limit.arn
}
