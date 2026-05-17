output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.api.function_name
}

output "function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.api.arn
}

output "invoke_arn" {
  description = "Lambda invoke ARN (for API Gateway integrations)"
  value       = aws_lambda_function.api.invoke_arn
}

output "role_arn" {
  description = "IAM role ARN"
  value       = aws_iam_role.lambda.arn
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.api.name
}
