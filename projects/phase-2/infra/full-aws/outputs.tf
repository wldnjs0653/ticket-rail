output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_subnet_ids" {
  value = module.vpc.private_subnets
}

output "rosa_cluster_id" {
  value = module.rosa.cluster_id
}

output "valkey_primary_endpoint" {
  value = aws_elasticache_replication_group.valkey.primary_endpoint_address
}

output "postgres_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "postgres_master_secret_arn" {
  value = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "msk_cluster_arn" {
  value = aws_msk_cluster.kafka.arn
}

output "msk_iam_bootstrap_brokers" {
  value = aws_msk_cluster.kafka.bootstrap_brokers_sasl_iam
}
