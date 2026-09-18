# AWS Containerized Deployment Plan: 3D Reconstruction & Floor Plan System

## 1. Architecture Overview & Microservice Workload Analysis

This repository is architected as a modular, decoupled spatial computing and 3D reconstruction system composed of independent microservices:

1. **Next.js Frontend (`frontend` - Port 3000)**: React 19 + Three.js 3D viewer canvas, responsive layout, tour walkthrough engine, and client-side Google OAuth handshakes.
2. **Auth Microservice (`auth_service` - Port 8002)**: Dedicated, ultra-lightweight identity service for Google OAuth 2.0 / OIDC, JWT issuing/verification (`HS256`), and PostgreSQL `users` table management. Completely isolated from heavy compute.
3. **Guided Tour Microservice (`tour_service` - Port 8001)**: Fully self-contained demo microservice serving static 3D point clouds (`.ply`), dimensioned floor plans (`.svg`), sample ISO HO-3 insurance policies, and deterministic tour chat with sub-10ms latency and zero database dependencies.
4. **Main Backend Service (`backend` - Port 8000)**: Heavy REST API for real job dispatch, LiDAR/RoomPlan coordinate ingestion, LLM insurance claim orchestration, and Celery task enqueueing. (Dormant during lightweight tour deployments).
5. **Celery GPU Worker (`worker`)**: Asynchronous compute running on-demand:
   - **COLMAP**: Structure-from-Motion (SfM) + CUDA dense MVS (`patch_match_stereo`, stereo fusion).
   - **Open3D / RANSAC**: Point cloud cleaning, plane segmentation, wall projection, 2D vector generation.
   - **ReportLab**: PDF report and insurance claim analysis.
6. **Database (RDS PostgreSQL)**: Hosts the `users` table (managed by `auth_service`) and `jobs`/`claims` relational schema.
7. **Broker / Queue (Redis)**: Celery task queue and pub/sub WebSocket message bridge.
8. **Shared Storage (Amazon EFS & S3)**: Amazon EFS (`/app/data`) for scratch COLMAP files and Amazon S3 for durable production assets.

```mermaid
flowchart TD
    subgraph Client ["Clients"]
        Browser["Next.js Web / Mobile Client (Port 3000)"]
    end

    subgraph Ingress ["Edge & Ingress"]
        ALB["Application Load Balancer (HTTPS Port 443)"]
    end

    subgraph CoreServices ["Lightweight Services (Phase 1 — Current)"]
        AuthSvc["Auth Service (Fargate :8002)\n• Google OAuth 2.0 / OIDC\n• JWT Token Minting\n• Users Table in RDS"]
        TourSvc["Tour Service (Fargate :8001)\n• Demo Point Cloud (.ply)\n• Floor Plan (.svg)\n• Zero DB Dependencies"]
        RDS["Amazon RDS PostgreSQL\n(db.t4g.micro)\n• users table\n• claims & jobs schema"]
    end

    subgraph HeavyPipeline ["Heavy Reconstruction Pipeline (Phase 2 — Pluggable)"]
        MainAPI["Main Backend (Fargate :8000)\n• Job & Upload Dispatch\n• LLM Claim Orchestration"]
        Redis["ElastiCache / Fargate Redis\n• Celery Broker & PubSub"]
        EFS["Amazon EFS Storage\n• /app/data shared workspace"]
        GPUWorker["EC2 Spot g4dn.xlarge\n• COLMAP CUDA SfM/MVS\n• Open3D RANSAC\n• Scales to 0 when idle"]
        S3["Amazon S3 Bucket\n• Permanent 3D Assets (.ply/.glb)"]
    end

    Browser -->|Path: /api/v1/auth/*| ALB
    Browser -->|Path: /api/v1/tour/*| ALB
    Browser -->|Path: /jobs/*, /api/v1/*| ALB
    Browser -->|Path: /* (Default)| ALB

    ALB -->|Route Priority 10| AuthSvc
    ALB -->|Route Priority 20| TourSvc
    ALB -->|Route Priority 30| MainAPI

    AuthSvc --> RDS
    MainAPI --> RDS
    MainAPI --> Redis
    MainAPI --> EFS

    Redis -.->|Celery Queue| GPUWorker
    GPUWorker --> RDS
    GPUWorker --> EFS
    GPUWorker --> S3
```

---

## 2. GPU Acceleration on AWS: Technical & Financial Analysis

### Why GPU is Critical for COLMAP
- **Sparse Reconstruction (SfM)**: Feature extraction (`SiftGPU`) and matching run **5x to 15x faster** on NVIDIA GPUs than CPU multithreading.
- **Dense Stereo (MVS)**: COLMAP's `patch_match_stereo` **natively requires an NVIDIA CUDA GPU** (Compute Capability $\ge 3.0$). Running dense MVS without CUDA requires either custom CPU forks or skipping dense stereo and relying on sparse cloud meshing (Poisson surface reconstruction on sparse points), which produces significantly lower quality walls and meshes.
- **Processing Time Comparison** (for ~60 high-res photos):
  - **CPU-only (4 vCPU)**: 25 – 45 minutes (high risk of timeout or memory exhaustion).
  - **NVIDIA T4 GPU (g4dn.xlarge)**: 3 – 6 minutes.

### GPU Instance Selection on AWS
| Instance Type | GPU | VRAM | vCPU | RAM | On-Demand ($/hr) | Spot Price ($/hr) | Suitability |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`g4dn.xlarge`** *(Recommended)* | 1x NVIDIA T4 | 16 GB | 4 | 16 GB | **$0.526** | **~$0.158** (70% off) | **Optimal balance of price, CUDA 7.5, and 16GB VRAM.** |
| **`g5.xlarge`** | 1x NVIDIA A10G | 24 GB | 4 | 16 GB | $1.006 | ~$0.402 | Best for larger NeRF/Gaussian Splatting pipelines. |
| **`p3.2xlarge`** | 1x NVIDIA V100 | 16 GB | 8 | 61 GB | $3.06 | ~$0.918 | Overkill and unnecessary cost for standard COLMAP. |

### The "Scale-to-Zero" Pattern (Avoid the $380/mo idle GPU trap)
- If you run a `g4dn.xlarge` 24/7 on-demand: $0.526 \times 730\text{ hrs} = \mathbf{\$384/\text{month}}$ **even if nobody uses it**.
- **The Solution for a "Couple of Users"**:
  1. FastAPI runs on lightweight serverless containers (ECS Fargate) for pennies.
  2. Celery Worker runs in an ECS EC2 Auto-Scaling Group (ASG) or AWS Batch backed by `g4dn.xlarge` (with Spot Instances enabled).
  3. **Auto-Scaling Metric**: Scale based on Celery Queue length (tracked via Redis queue depth CloudWatch metric).
     - When queue is 0: Desired instances = 0 (**$0.00/hr**).
     - When a user uploads a reconstruction job: ASG launches a Spot `g4dn.xlarge` in ~90 seconds.
     - The job executes (3–5 min), results are uploaded to S3, and after 10 minutes of inactivity, the instance terminates.
  4. **Cost per reconstruction job**: $\approx \mathbf{\$0.02 - \$0.04}$ per job!

---

## 3. Storage Architecture: S3 vs EFS

COLMAP makes thousands of random read/writes to local files (`db.db`, workspace image pairs, depth maps). Running COLMAP directly over S3 APIs causes extreme latency and failure.

| Storage | Role | Configuration |
| :--- | :--- | :--- |
| **Amazon EFS (Elastic File System)** | High-throughput shared workspace mounted at `/app/data` across both API and Celery Worker containers. | General Purpose, One Zone (lower cost), provisioned with Lifecycle policy to transition cold files to EFS Infrequent Access (IA). |
| **Amazon S3** | Durable storage for final artifacts (point cloud `.ply`, textured `.glb`, 2D floor plan `.svg`/`.png`, PDF reports, original video archives). | Standard storage with automated pre-signed URLs for client downloads. |

---

## 4. Deployment Profiles & Cost Breakdown

The infrastructure supports two decoupled deployment profiles controlled by a single Terraform flag (`enable_heavy_pipeline`):

### Profile A: Lightweight Tour & Identity Deployment (Phase 1 — Current Target)
*Deploys: Next.js Frontend (Fargate) + Auth Microservice (Fargate) + Tour Microservice (Fargate) + RDS PostgreSQL (`db.t4g.micro`) + ALB.*
*Excludes: Redis, Celery, EFS, and EC2 GPU instances.*

| Component | Sizing / Configuration | Monthly Cost (USD) |
| :--- | :--- | :--- |
| **Next.js Frontend** | ECS Fargate: 0.25 vCPU, 512 MB RAM (1 task) | ~$4.50 |
| **Auth Microservice** | ECS Fargate: 0.25 vCPU, 256 MB RAM (1 task) | ~$3.50 |
| **Guided Tour Microservice** | ECS Fargate: 0.25 vCPU, 256 MB RAM (1 task) | ~$3.50 |
| **Amazon RDS PostgreSQL** | `db.t4g.micro` (Free-tier eligible for 12 months) | **$0.00** (or ~$13.50 after year 1) |
| **Application Load Balancer** | 1 ALB (routes paths across all microservices) | ~$18.00 |
| **Amazon ECR & CloudWatch Logs** | Minimal container registries & 7-day log retention | ~$2.00 |
| **Total Monthly Cost (Profile A)** | | **~$31.50 / month** (or ~$18.00 with AWS Free Tier) |

> [!NOTE]
> **Complete Blast Radius Protection**: In Profile A, there are zero Redis dependencies and zero Celery workers. The user login flow, Google OAuth handshake, and 3D walkthrough demo run with 100% uptime, unaffected by heavy spatial or worker code.

---

### Profile B: Full Reconstruction Pipeline (Phase 2 — Scale-to-Zero GPU Worker)
*Adds: Main Backend API (Fargate) + Containerized Redis + Amazon EFS + Scale-to-Zero Spot `g4dn.xlarge` Worker.*

| Additional Component | Sizing / Configuration | Additional Cost (USD) |
| :--- | :--- | :--- |
| **Main Backend API** | ECS Fargate: 0.5 vCPU, 1 GB RAM (1 task) | ~$11.00 |
| **Redis Broker** | ECS Fargate: 0.25 vCPU, 512 MB RAM | ~$5.50 |
| **Amazon EFS** | 20 GB General Purpose (Scratch workspace) | ~$6.00 |
| **Amazon S3 & Data Transfer** | 50 GB permanent storage + egress | ~$2.50 |
| **Worker GPU Compute (`g4dn.xlarge`)** | 50 jobs/month $\times$ 5 min = ~4.2 hrs @ Spot ($0.16/hr) | **~$0.80** |
| **Total Monthly Cost (Profile B Combined)** | | **~$57.30 / month** |

---

## 5. Ingress Traffic Routing & Application Load Balancer Rules

All traffic enters via port 443 (HTTPS) on a single Application Load Balancer. Listener rules route requests deterministically by path prefix:

| Priority | Path Pattern | Target Group | Container Port | Service Role |
| :--- | :--- | :--- | :--- | :--- |
| **10** | `/api/v1/auth/*` | `tg-auth-service` | `8002` | Google OAuth, JWT tokens, users table |
| **20** | `/api/v1/tour/*` | `tg-tour-service` | `8001` | Sample claim, point cloud PLY, SVG, tour chat |
| **30** | `/api/v1/*`, `/jobs/*`, `/claims/*` | `tg-main-backend` | `8000` | Real upload processing & claims (Profile B) |
| **100** | `/*` *(Default Rule)* | `tg-frontend` | `3000` | Next.js web application & 3D viewer UI |

---

## 6. Terraform (IaC) Modular Directory Structure

A clean, modular Terraform hierarchy allowing instant toggling between Profile A (Lightweight) and Profile B (Full):

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars           # enable_heavy_pipeline = false
│   └── prod/
│       ├── main.tf
│       ├── variables.tf
│       └── terraform.tfvars
└── modules/
    ├── vpc/                           # VPC, 2 public & 2 private subnets, NAT Gateway
    ├── security/                      # Security groups (ALB, ECS, RDS) & IAM execution roles
    ├── database/                      # RDS PostgreSQL (db.t4g.micro in private subnet)
    ├── alb/                           # ALB, HTTPS listener, SSL certificate, 4 Target Groups & path rules
    ├── ecr/                           # Registries for frontend, auth_service, tour_service, backend, worker
    ├── ecs_cluster/                   # ECS cluster definition & capacity providers
    ├── ecs_services_lightweight/      # Fargate services for Frontend (3000), Auth (8002), Tour (8001)
    ├── storage_heavy/                 # [Profile B] EFS file system and S3 bucket (count = enable_heavy_pipeline ? 1 : 0)
    ├── ecs_services_heavy/            # [Profile B] Fargate services for Main API (8000) & Redis
    └── worker_asg/                    # [Profile B] g4dn.xlarge Launch Template, Auto Scaling Group (0-2)
```

---

## 6. Key Terraform Script Blueprints

### A. EFS File System for Container Shared Storage (`modules/storage/efs.tf`)
```hcl
resource "aws_efs_file_system" "pipeline_storage" {
  creation_token   = "${var.environment}-floorplan-data"
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  encrypted        = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = {
    Name        = "${var.environment}-floorplan-efs"
    Environment = var.environment
  }
}

resource "aws_efs_mount_target" "efs_targets" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.pipeline_storage.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [var.efs_security_group_id]
}

resource "aws_efs_access_point" "app_data" {
  file_system_id = aws_efs_file_system.pipeline_storage.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/data"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }
}
```

### B. GPU Worker EC2 Launch Template & Auto Scaling (`modules/worker_asg/main.tf`)
```hcl
# User data to join ECS cluster and configure NVIDIA GPU runtime
locals {
  user_data = <<-EOF
              #!/bin/bash
              echo "ECS_CLUSTER=${var.ecs_cluster_name}" >> /etc/ecs/ecs.config
              echo "ECS_ENABLE_GPU_SUPPORT=true" >> /etc/ecs/ecs.config
              EOF
}

resource "aws_launch_template" "gpu_worker" {
  name_prefix   = "${var.environment}-gpu-worker-"
  image_id      = var.ecs_gpu_optimized_ami_id  # Recommended: amzn2-ami-ecs-gpu-hvm
  instance_type = "g4dn.xlarge"

  iam_instance_profile {
    name = var.ecs_instance_profile_name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [var.worker_security_group_id]
  }

  user_data = base64encode(locals.user_data)

  instance_market_options {
    market_type = "spot"
    spot_options {
      max_price = "0.25"  # Cap spot bid
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.environment}-ecs-gpu-worker"
    }
  }
}

resource "aws_autoscaling_group" "gpu_worker_asg" {
  name_prefix         = "${var.environment}-gpu-asg-"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = 0
  max_size            = 2
  desired_capacity    = 0  # Scales to zero when idle

  launch_template {
    id      = aws_launch_template.gpu_worker.id
    version = "$Latest"
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = true
    propagate_at_launch = true
  }
}
```

### C. ECS Task Definition with GPU Resource Requirement (`modules/worker_asg/task_def.tf`)
```hcl
resource "aws_ecs_task_definition" "celery_gpu_worker" {
  family                   = "${var.environment}-celery-gpu-worker"
  requires_compatibilities = ["EC2"]
  network_mode             = "awsvpc"
  memory                   = "14000"
  cpu                      = "3800"
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  volume {
    name = "efs-data"
    efs_volume_configuration {
      file_system_id     = var.efs_file_system_id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = var.efs_access_point_id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "celery-worker"
      image     = "${var.worker_ecr_url}:latest"
      essential = true
      command   = ["celery", "-A", "app.tasks.celery_tasks", "worker", "--loglevel=info", "--concurrency=1"]

      resourceRequirements = [
        {
          type  = "GPU"
          value = "1"
        }
      ]

      environment = [
        { name = "DATABASE_URL", value = var.database_url },
        { name = "DATABASE_SYNC_URL", value = var.database_sync_url },
        { name = "REDIS_URL", value = var.redis_url },
        { name = "CELERY_BROKER_URL", value = var.redis_url },
        { name = "DATA_DIR", value = "/app/data" },
        { name = "COLMAP_USE_GPU", value = "1" }
      ]

      mountPoints = [
        {
          sourceVolume  = "efs-data"
          containerPath = "/app/data"
          readOnly      = false
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.environment}/celery-worker"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}
```

---

## 7. Container Images Inventory & Status

| Image | Base Image | Size | Build Context | Deployment Profile | Current Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`claimspace-auth-service`** | `python:3.11-slim` | ~115 MB | `./auth_service` | Profile A & B | ✅ **Ready** ([Dockerfile](file:///Users/aadarshkt/Desktop/3DReconstruction/auth_service/Dockerfile)) |
| **`claimspace-tour-service`** | `python:3.11-slim` | ~125 MB | `./tour_service` | Profile A & B | ✅ **Ready** ([Dockerfile](file:///Users/aadarshkt/Desktop/3DReconstruction/tour_service/Dockerfile)) |
| **`claimspace-frontend`** | `node:20-alpine` | ~160 MB | `./frontend` | Profile A & B | ⏳ **Needs Dockerfile** (Next.js Standalone) |
| **`claimspace-backend`** | `python:3.11-slim` | ~220 MB | `./backend` | Profile B | ⏳ Future Phase (Split from heavy worker) |
| **`claimspace-worker`** | `nvidia/cuda:12.2.2`| ~3.5 GB | `./backend` | Profile B | ⏳ Future Phase (CUDA + COLMAP + Open3D) |

---

## 8. Actionable Implementation Task List (Next Steps)

### Phase 1: Container Hardening & Local Smoke Testing
- [ ] **Task 1.1: Create Frontend Production Dockerfile**
  - Create `frontend/Dockerfile` using multi-stage Node.js 20 Alpine and Next.js `standalone` output mode.
  - Verify `frontend/next.config.ts` has `output: "standalone"` and proxies `/api/v1/auth/*` to `:8002` and `/api/v1/tour/*` to `:8001`.
- [ ] **Task 1.2: Local Multi-Container Smoke Test**
  - Run `auth_service` (port 8002) connected to local PostgreSQL.
  - Run `tour_service` (port 8001).
  - Run Next.js (port 3000).
  - Confirm `/api/v1/auth/health`, `/api/v1/tour/health`, dev-login, and tour 3D viewer all function with zero errors.

### Phase 2: Cloud Identity & Secrets Setup
- [ ] **Task 2.1: Google Cloud Console OAuth Credentials**
  - Configure OAuth Consent screen (External / ClaimSpace 3D).
  - Add Authorized JavaScript origin (`https://<ALB_DOMAIN>`).
  - Add Authorized Redirect URI (`https://<ALB_DOMAIN>/auth/callback`).
  - Obtain `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- [ ] **Task 2.2: AWS SSM Parameter Store Secret Provisioning**
  - Create `/claimspace/production/GOOGLE_CLIENT_ID` (String).
  - Create `/claimspace/production/GOOGLE_CLIENT_SECRET` (SecureString).
  - Create `/claimspace/production/JWT_SECRET_KEY` (SecureString — 32-byte hex).
  - Create `/claimspace/production/DATABASE_URL` (SecureString for RDS PostgreSQL).

### Phase 3: Terraform Baseline Provisioning (Profile A: Lightweight)
- [ ] **Task 3.1: Create Terraform Modules for Profile A**
  - Write `modules/vpc` (2 public subnets, 2 private subnets, IGW, NAT Gateway).
  - Write `modules/database` (RDS PostgreSQL `db.t4g.micro`, private-only, security group locked to ECS).
  - Write `modules/ecr` (Repositories: `claimspace-frontend`, `claimspace-auth`, `claimspace-tour`).
  - Write `modules/alb` (ALB with HTTPS listener and priority rules for `/api/v1/auth/*`, `/api/v1/tour/*`, and `/*`).
  - Write `modules/ecs_services_lightweight` (Fargate task definitions and services for Frontend, Auth, and Tour).
- [ ] **Task 3.2: Push Images to Amazon ECR**
  - Build and tag `claimspace-frontend`, `claimspace-auth-service`, and `claimspace-tour-service`.
  - Authenticate Docker with ECR and push all 3 images.
- [ ] **Task 3.3: Apply Terraform Execution**
  - Run `terraform init` and `terraform apply -var="enable_heavy_pipeline=false"`.

### Phase 4: Production Verification & Smoke Testing
- [ ] **Task 4.1: Database Schema Auto-Creation**
  - Verify that upon first launch of `auth_service`, SQLAlchemy executes `create_all` and creates the `users` table on RDS.
- [ ] **Task 4.2: Ingress & Health Checks**
  - `curl https://<DOMAIN>/api/v1/auth/health` $\rightarrow$ returns 200 OK.
  - `curl https://<DOMAIN>/api/v1/tour/health` $\rightarrow$ returns 200 OK.
  - `curl https://<DOMAIN>/` $\rightarrow$ loads Next.js landing page.
- [ ] **Task 4.3: OAuth End-to-End Verification**
  - Click "Continue with Google" on production web app.
  - Complete consent $\rightarrow$ callback redirects with authenticated JWT cookie.
  - Inspect RDS `users` table to confirm user profile row was created with `role = 'user'` (or `'admin'` if matching `INITIAL_ADMIN_EMAIL`).
- [ ] **Task 4.4: 3D Tour & AI Chat Smoke Test**
  - Open `/tour` in browser.
  - Confirm interactive 3D point cloud (`.ply`) and 2D floor plan (`.svg`) render in Three.js canvas.
  - Ask sample chat question ("Is water damage covered?") $\rightarrow$ verifies sub-10ms policy response.

### Phase 5: Future Activation of Profile B (Heavy 3D Reconstruction)
- [ ] Split `backend/Dockerfile` into `Dockerfile.api` and `Dockerfile.worker`.
- [ ] Set `enable_heavy_pipeline = true` in Terraform to provision Redis, Amazon EFS, and EC2 GPU Spot Auto Scaling Group (`g4dn.xlarge`).
