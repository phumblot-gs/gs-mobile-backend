output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  description = "Default execute-api URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "stage_invoke_url" {
  description = "Stage invoke URL"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "custom_domain" {
  description = "Custom domain (if configured)"
  value       = try(aws_apigatewayv2_domain_name.api[0].domain_name, null)
}

output "custom_domain_target" {
  description = "CNAME target for the custom domain"
  value       = try(aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].target_domain_name, null)
}

output "acm_validation_records" {
  description = "DNS validation records for the ACM certificate"
  value       = try(aws_acm_certificate.api[0].domain_validation_options, null)
}
