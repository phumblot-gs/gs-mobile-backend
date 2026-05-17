data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api-${var.environment}"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = var.timeout
  memory_size   = var.memory_size

  filename = data.archive_file.placeholder.output_path

  environment {
    variables = {
      ENVIRONMENT                  = var.environment
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      DYNAMO_OAUTH_STATE_TABLE     = var.dynamodb_oauth_state_name
      DYNAMO_OAUTH_SESSIONS_TABLE  = var.dynamodb_oauth_sessions_name
      S3_UPLOADS_BUCKET            = var.s3_uploads_bucket_name
      S3_PACKSHOTS_BUCKET          = var.s3_packshots_bucket_name
      PUBLIC_BASE_URL              = var.public_base_url
      MOBILE_DEEP_LINK_SCHEME      = var.mobile_deep_link_scheme
      SECRET_GS_OAUTH_CLIENT_ID    = var.secret_gs_oauth_client_id_name
      SECRET_GS_OAUTH_CLIENT_SECRET = var.secret_gs_oauth_client_secret_name
      SECRET_GS_OAUTH_BASE_URL     = var.secret_gs_oauth_base_url_name
      SECRET_PHOTOROOM_API_KEY     = var.secret_photoroom_api_key_name
      SECRET_AUTORETOUCH_API_KEY   = var.secret_autoretouch_api_key_name
    }
  }

  # The code is replaced by CI/CD via `aws lambda update-function-code` — Terraform
  # should not touch it after the first apply.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = {
    Name = "${var.project_name}-api-${var.environment}"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = var.log_retention_days
}
