resource "aws_dynamodb_table" "oauth_state" {
  name         = "${var.project_name}-oauth-state-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "state"

  attribute {
    name = "state"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  tags = {
    Name = "${var.project_name}-oauth-state-${var.environment}"
  }
}

resource "aws_dynamodb_table" "oauth_sessions" {
  name         = "${var.project_name}-oauth-sessions-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  tags = {
    Name = "${var.project_name}-oauth-sessions-${var.environment}"
  }
}
