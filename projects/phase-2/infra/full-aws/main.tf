locals {
  availability_zones = ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"]

  data_ports = {
    valkey   = 6379
    postgres = 5432
    msk      = 9098
  }
}

module "vpc" {
  source  = "terraform-redhat/rosa-hcp/rhcs//modules/vpc"
  version = "1.6.8"

  name_prefix        = var.name
  vpc_cidr           = "10.20.0.0/16"
  availability_zones = local.availability_zones
}

resource "aws_security_group" "workers" {
  name_prefix = "${var.name}-workers-"
  description = "TicketRail ROSA workers that access managed data services"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_security_group" "data" {
  for_each = local.data_ports

  name_prefix = "${var.name}-${each.key}-"
  description = "TicketRail ${each.key} ingress from ROSA workers"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "data_from_workers" {
  for_each = local.data_ports

  security_group_id            = aws_security_group.data[each.key].id
  referenced_security_group_id = aws_security_group.workers.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_egress_rule" "workers_to_data" {
  for_each = local.data_ports

  security_group_id            = aws_security_group.workers.id
  referenced_security_group_id = aws_security_group.data[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_ingress_rule" "msk_broker_ingress" {
  security_group_id            = aws_security_group.data["msk"].id
  referenced_security_group_id = aws_security_group.data["msk"].id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_egress_rule" "msk_broker_egress" {
  security_group_id            = aws_security_group.data["msk"].id
  referenced_security_group_id = aws_security_group.data["msk"].id
  ip_protocol                  = "-1"
}

module "rosa" {
  source  = "terraform-redhat/rosa-hcp/rhcs"
  version = "1.6.8"

  cluster_name             = var.name
  openshift_version        = var.openshift_version
  private                  = false
  machine_cidr             = module.vpc.cidr_block
  aws_subnet_ids           = concat(module.vpc.public_subnets, module.vpc.private_subnets)
  aws_availability_zones   = module.vpc.availability_zones
  replicas                 = length(module.vpc.availability_zones)
  ec2_metadata_http_tokens = "required"

  aws_additional_compute_security_group_ids = [aws_security_group.workers.id]

  create_account_roles  = true
  account_role_prefix   = "${var.name}-account"
  create_oidc           = true
  create_operator_roles = true
  operator_role_prefix  = "${var.name}-operator"
}

resource "aws_elasticache_subnet_group" "valkey" {
  name       = "${var.name}-valkey"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "valkey" {
  replication_group_id = "${var.name}-valkey"
  description          = "TicketRail queue and seat holds"

  engine               = "valkey"
  engine_version       = "7.2"
  parameter_group_name = "default.valkey7"
  node_type            = "cache.r7g.large"
  num_cache_clusters   = 3
  port                 = local.data_ports.valkey

  subnet_group_name          = aws_elasticache_subnet_group.valkey.name
  security_group_ids         = [aws_security_group.data["valkey"].id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = var.valkey_auth_token
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${var.name}-postgres"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "postgres" {
  identifier                  = "${var.name}-postgres"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.m6g.large"
  allocated_storage           = 30
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "ticketrail"
  username                    = "ticketrail_admin"
  manage_master_user_password = true
  port                        = local.data_ports.postgres

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.data["postgres"].id]
  publicly_accessible    = false
  multi_az               = true

  backup_retention_period   = 7
  deletion_protection       = var.database_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = var.database_final_snapshot_identifier
}

resource "aws_msk_cluster" "kafka" {
  cluster_name           = "${var.name}-msk"
  kafka_version          = "3.9.x"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = "kafka.m5.large"
    client_subnets  = module.vpc.private_subnets
    security_groups = [aws_security_group.data["msk"].id]

    storage_info {
      ebs_storage_info {
        volume_size = 100
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  client_authentication {
    sasl {
      iam = true
    }
  }
}
