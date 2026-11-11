terraform {
  required_version = ">= 1.5, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100.0"
    }
    rhcs = {
      source  = "terraform-redhat/rhcs"
      version = "~> 1.6.2"
    }
  }
}

provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project     = "TicketRail"
      Environment = "full-aws-reference"
    }
  }
}

provider "rhcs" {}
