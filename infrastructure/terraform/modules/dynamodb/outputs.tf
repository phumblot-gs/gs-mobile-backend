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
