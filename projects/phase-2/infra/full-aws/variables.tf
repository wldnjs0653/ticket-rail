variable "name" {
  description = "Name prefix for the ROSA cluster and AWS resources."
  type        = string
  default     = "ticketrail"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,13}[a-z0-9]$", var.name)) && !strcontains(var.name, "--")
    error_message = "Use 3–15 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit. Consecutive hyphens are invalid."
  }
}

variable "openshift_version" {
  description = "ROSA HCP OpenShift version available to the Red Hat account in ap-northeast-2."
  type        = string
}

variable "valkey_auth_token" {
  description = "AUTH token for the Valkey replication group."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9!&#$^<>-]{16,128}$", var.valkey_auth_token))
    error_message = "Use a 16–128 character ElastiCache AUTH token."
  }
}

variable "database_deletion_protection" {
  description = "Require an explicit change before deleting the RDS instance."
  type        = bool
  default     = true
}

variable "database_final_snapshot_identifier" {
  description = "Unique name for the final RDS snapshot in this region."
  type        = string
  default     = "ticketrail-full-aws-final"
}
