# =============================================================================
# Uploads bucket — short-lived raw images uploaded by the iOS app via presigned URL
# =============================================================================
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${var.environment}"

  tags = {
    Name = "${var.project_name}-uploads-${var.environment}"
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "expire-raw-uploads"
    status = "Enabled"

    filter {}

    expiration {
      days = var.uploads_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_methods = ["PUT", "POST", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

# =============================================================================
# Packshots bucket — long-lived processed images
# =============================================================================
resource "aws_s3_bucket" "packshots" {
  bucket = "${var.project_name}-packshots-${var.environment}"

  tags = {
    Name = "${var.project_name}-packshots-${var.environment}"
  }
}

resource "aws_s3_bucket_public_access_block" "packshots" {
  bucket                  = aws_s3_bucket.packshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "packshots" {
  bucket = aws_s3_bucket.packshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "packshots" {
  bucket = aws_s3_bucket.packshots.id

  rule {
    id     = "transition-packshots-to-ia"
    status = "Enabled"

    filter {}

    transition {
      days          = var.packshots_ia_transition_days
      storage_class = "STANDARD_IA"
    }

    # No expiration — we keep packshots indefinitely.
  }
}
