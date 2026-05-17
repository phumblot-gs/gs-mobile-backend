terraform {
  backend "s3" {
    bucket         = "gs-mobile-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "gs-mobile-terraform-lock"
    encrypt        = true
  }
}
