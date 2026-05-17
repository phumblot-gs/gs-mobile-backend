output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "packshots_bucket_name" {
  value = aws_s3_bucket.packshots.id
}

output "packshots_bucket_arn" {
  value = aws_s3_bucket.packshots.arn
}
