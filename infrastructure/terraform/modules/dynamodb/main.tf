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

# Centralised settings — pointer to the currently-applied version, one row per
# (main_account_id, active_account_id).
resource "aws_dynamodb_table" "account_settings_pointer" {
  name         = "${var.project_name}-account-settings-pointer-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "main_account_id"
  range_key    = "active_account_id"

  attribute {
    name = "main_account_id"
    type = "N"
  }

  attribute {
    name = "active_account_id"
    type = "N"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.project_name}-account-settings-pointer-${var.environment}"
  }
}

# Centralised settings — historical versions, one row per ULID.
# account_pair PK = "<main>#<active>" so a single Query returns the whole
# history of a pair (ULID SK is sortable by creation time).
resource "aws_dynamodb_table" "account_settings_version" {
  name         = "${var.project_name}-account-settings-version-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "account_pair"
  range_key    = "version_id"

  attribute {
    name = "account_pair"
    type = "S"
  }

  attribute {
    name = "version_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.project_name}-account-settings-version-${var.environment}"
  }
}

# Rate-limit counters. The TTL attribute (`expires_at`, epoch seconds) is
# Dynamo's native eviction mechanism — counters disappear once their window
# closes plus a small margin.
resource "aws_dynamodb_table" "account_settings_rate_limit" {
  name         = "${var.project_name}-account-settings-rate-limit-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "bucket_key"

  attribute {
    name = "bucket_key"
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
    Name = "${var.project_name}-account-settings-rate-limit-${var.environment}"
  }
}
