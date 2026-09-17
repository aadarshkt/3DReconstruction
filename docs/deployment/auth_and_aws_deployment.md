# Authentication & AWS Deployment Guide: Google OAuth, RBAC, and RDS Terraform Blueprint

This document details the architectural rationale, complete Google Cloud Console OAuth configuration, and the step-by-step AWS deployment blueprint using Terraform.

---

## 1. Architectural Rationale

### Why Google OAuth 2.0?
- **Zero Credential Liability**: No passwords, password hashes, salt algorithms, or password reset flows are stored or managed on our servers, eliminating database credential leakage risks.
- **Instant User Onboarding**: Users authenticate with one click using their verified Google identity.
- **Standardized Tokens**: Google provides signed OpenID Connect (OIDC) ID tokens containing verified email and user metadata.

### Why AWS RDS PostgreSQL Only (No AWS Cognito or Extra Auth Services)?
- **Zero AWS Vendor Lock-In**: The authentication layer uses open standards (OAuth 2.0 / OIDC / JWT). The app can run locally, on AWS, GCP, or bare metal without rewriting identity code.
- **Zero Extra Cloud Bill**: ClaimSpace already utilizes PostgreSQL. Adding a `users` table to the existing database adds **$0.00** in incremental infrastructure cost.
- **100% Free Tier Eligible**: Amazon RDS offers `db.t4g.micro` free for 750 hours/month for the first 12 months.
- **Complete Data Ownership**: User profiles, roles, and relational associations to claims are directly queryable in PostgreSQL without synchronizing external Cognito user pools.

### Why Strict RBAC (Admin vs User) with Isolated UIs?
- **Security & Integrity**: Administrative capabilities—such as triggering COLMAP closed-loop pipeline benchmarks, running synthetic claim seeders, or viewing system telemetry—must be completely segregated from policyholders.
- **Clean User Experience**: Policyholders need a streamlined, focused interface for scanning property damage and reviewing insurance coverage. They should never see internal telemetry or engineering debugging consoles.
- **Dedicated Admin Control**: Administrators need an operational dashboard for inspecting pipeline health, worker queues, and error logs without consumer-facing UI noise.

---

## 2. Google Cloud Console Setup (Step-by-Step)

Follow these exact steps to obtain your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`:

### Step 1: Create or Select a Google Cloud Project
1. Log into the [Google Cloud Console](https://console.cloud.google.com/).
2. In the top navigation bar, click the project dropdown and select **New Project**.
3. Name your project (e.g., `ClaimSpace-Production` or `ClaimSpace-3D`) and click **Create**.

### Step 2: Configure the OAuth Consent Screen
1. In the left navigation menu, go to **APIs & Services** > **OAuth consent screen**.
2. Under **User Type**, select:
   - **External**: Allows anyone with a Google Account to sign in (Standard for public SaaS).
   - *(Optional) Internal*: If you are using Google Workspace and only want internal company staff to sign in.
3. Click **Create**.
4. Fill in the required application information:
   - **App name**: `ClaimSpace 3D`
   - **User support email**: Select your email.
   - **App logo** *(Optional)*: Upload application icon.
   - **Developer contact information**: Your email address.
5. Click **Save and Continue**.
6. **Scopes**:
   - Click **Add or Remove Scopes**.
   - Select the standard OIDC scopes:
     - `.../auth/userinfo.email` (View your email address)
     - `.../auth/userinfo.profile` (View your basic profile)
     - `openid` (Associate you with your personal info on Google)
   - Click **Update** then **Save and Continue**.
7. **Test Users** *(If in 'Testing' mode)*:
   - Add your own email address to allow testing before submitting for public verification.
8. Click **Back to Dashboard**.

### Step 3: Create OAuth 2.0 Web Application Credentials
1. In the left navigation menu, navigate to **APIs & Services** > **Credentials**.
2. At the top of the page, click **+ Create Credentials** > **OAuth client ID**.
3. For **Application type**, choose **Web application**.
4. **Name**: `ClaimSpace Web Client`.
5. **Authorized JavaScript origins**:
   - For local development: `http://localhost:3000`
   - For production: `https://app.claimspace.com` (or your AWS ALB / CloudFront domain)
6. **Authorized redirect URIs**:
   - For local development: `http://localhost:3000/auth/callback`
   - For production: `https://app.claimspace.com/auth/callback`
7. Click **Create**.
8. A modal will appear displaying your:
   - **Client ID** (e.g., `1234567890-abcdefg.apps.googleusercontent.com`)
   - **Client Secret** (e.g., `GOCSPX-abc123xyz456`)
9. Copy both values; you will place them in your environment variables.

---

## 3. AWS Infrastructure Topology (Terraform Blueprint)

```
AWS VPC (10.0.0.0/16)
│
├── Public Subnets (10.0.1.0/24, 10.0.2.0/24)
│   ├── Internet Gateway (IGW)
│   ├── NAT Gateway
│   └── Application Load Balancer (ALB)
│       └── Port 80 / 443 Listeners (ACM SSL Certificate)
│
└── Private Subnets (10.0.10.0/24, 10.0.20.0/24)
    ├── ECS Fargate Cluster
    │   ├── Next.js Service (Port 3000)
    │   └── FastAPI Backend Service (Port 8000)
    │
    └── DB Subnet Group (Private Only)
        └── Amazon RDS PostgreSQL (Port 5432)
```

---

## 4. Terraform Implementation Steps & Resource Declarations

### Step 1: Networking & Security Group Hierarchy
The database must be completely inaccessible from the public internet. Only the backend ECS tasks should have network access to PostgreSQL port 5432.

```hcl
# 1. VPC and Subnets
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "claimspace-vpc" }
}

# 2. RDS Subnet Group spanning across 2 Availability Zones
resource "aws_db_subnet_group" "rds_subnet_group" {
  name       = "claimspace-rds-subnets"
  subnet_ids = [aws_subnet.private_az1.id, aws_subnet.private_az2.id]
}

# 3. Security Group for ECS Backend
resource "aws_security_group" "ecs_backend_sg" {
  name        = "claimspace-ecs-backend-sg"
  description = "Allows traffic from ALB to FastAPI"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 4. Security Group for RDS (Locked strictly to ECS Backend)
resource "aws_security_group" "rds_sg" {
  name        = "claimspace-rds-sg"
  description = "Allow inbound PostgreSQL from backend ECS tasks only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from Backend ECS SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_backend_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

### Step 2: Amazon RDS PostgreSQL Instance
```hcl
resource "aws_db_instance" "postgres" {
  identifier             = "claimspace-db"
  engine                 = "postgres"
  engine_version         = "16.1"
  instance_class         = "db.t4g.micro"       # Eligible for AWS 12-month Free Tier
  allocated_storage      = 20                   # 20 GB gp3 storage
  max_allocated_storage  = 50                   # Autoscaling ceiling
  storage_type           = "gp3"
  db_name                = "claimspace"
  username               = "claimspace_admin"
  password               = var.db_master_password # Passed securely via tfvars
  db_subnet_group_name   = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  publicly_accessible    = false                # Zero direct internet exposure
  skip_final_snapshot    = true                 # Set false in production
  deletion_protection    = false                # Set true in production

  tags = {
    Environment = "production"
    Application = "ClaimSpace"
  }
}
```

### Step 3: Secrets & Environment Configuration in AWS SSM / Secrets Manager
Store sensitive credentials in AWS Systems Manager (SSM) Parameter Store or AWS Secrets Manager:

```hcl
resource "aws_ssm_parameter" "google_client_id" {
  name  = "/claimspace/production/GOOGLE_CLIENT_ID"
  type  = "String"
  value = var.google_client_id
}

resource "aws_ssm_parameter" "google_client_secret" {
  name  = "/claimspace/production/GOOGLE_CLIENT_SECRET"
  type  = "SecureString"
  value = var.google_client_secret
}

resource "aws_ssm_parameter" "jwt_secret_key" {
  name  = "/claimspace/production/JWT_SECRET_KEY"
  type  = "SecureString"
  value = var.jwt_secret_key # Generate with: openssl rand -hex 32
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/claimspace/production/DATABASE_URL"
  type  = "SecureString"
  value = "postgresql+asyncpg://${aws_db_instance.postgres.username}:${var.db_master_password}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}"
}
```

### Step 4: Inject Secrets into ECS Task Definition
In your backend ECS Task Definition JSON, reference the SSM parameter ARNs:

```json
{
  "name": "backend",
  "image": "<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/claimspace-backend:latest",
  "secrets": [
    { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:us-east-1:<ID>:parameter/claimspace/production/DATABASE_URL" },
    { "name": "JWT_SECRET_KEY", "valueFrom": "arn:aws:ssm:us-east-1:<ID>:parameter/claimspace/production/JWT_SECRET_KEY" },
    { "name": "GOOGLE_CLIENT_ID", "valueFrom": "arn:aws:ssm:us-east-1:<ID>:parameter/claimspace/production/GOOGLE_CLIENT_ID" },
    { "name": "GOOGLE_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:us-east-1:<ID>:parameter/claimspace/production/GOOGLE_CLIENT_SECRET" }
  ],
  "environment": [
    { "name": "INITIAL_ADMIN_EMAIL", "value": "admin@yourcompany.com" },
    { "name": "ALLOW_DEV_LOGIN", "value": "false" }
  ],
  "portMappings": [
    { "containerPort": 8000, "hostPort": 8000 }
  ]
}
```

---

## 5. Operational Checklist & Things to Take Care Of

1. **Database Schema Auto-Creation**:
   - Ensure your FastAPI startup sequence includes `await conn.run_sync(Base.metadata.create_all)`. On the first ECS launch, SQLAlchemy automatically connects to RDS and creates the `users` table.
2. **Promoting / Creating Admin Roles for Known Users**:
   Once a user has signed in with their known email address (e.g. `lead.admin@company.com`), use any of the following methods to grant them the `admin` role:

   #### Method A: AWS ECS One-Off Task (Recommended for Production AWS)
   Run a standalone task on your ECS cluster to execute the role update CLI inside the VPC network:
   ```bash
   aws ecs run-task \
     --cluster claimspace-cluster \
     --task-definition claimspace-backend \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[\"<PRIVATE_SUBNET_ID>\"],securityGroups=[\"<ECS_BACKEND_SG_ID>\"],assignPublicIp=\"DISABLED\"}" \
     --overrides '{
       "containerOverrides": [
         {
           "name": "backend",
           "command": ["python", "-m", "app.cli", "set-role", "--email", "lead.admin@company.com", "--role", "admin"]
         }
       ]
     }'
   ```

   #### Method B: AWS ECS Exec (Interactive Shell in Running Container)
   If you have enabled `enable-execute-command` on your ECS service, jump into the running container:
   ```bash
   # 1. Get task ID
   TASK_ID=$(aws ecs list-tasks --cluster claimspace-cluster --service-name claimspace-backend-service --query 'taskArns[0]' --output text | cut -d/ -f3)

   # 2. Open interactive shell
   aws ecs execute-command \
     --cluster claimspace-cluster \
     --task $TASK_ID \
     --container backend \
     --interactive \
     --command "/bin/sh"

   # 3. Inside the container, run the CLI:
   python -m app.cli set-role --email lead.admin@company.com --role admin
   python -m app.cli list-users
   ```

   #### Method C: Direct SQL Update on Amazon RDS PostgreSQL
   If you have an internal bastion host, VPN, or SSM session to your RDS instance:
   ```sql
   -- 1. Check existing role for the user:
   SELECT id, email, role, created_at FROM users WHERE email = 'lead.admin@company.com';

   -- 2. Promote user to admin:
   UPDATE users SET role = 'admin' WHERE email = 'lead.admin@company.com';

   -- 3. Confirm promotion:
   SELECT email, role FROM users WHERE email = 'lead.admin@company.com';
   ```

   #### Method D: Automatic Bootstrap on First Sign-In (`INITIAL_ADMIN_EMAIL`)
   In your ECS task definition or `.env` configuration, specify the primary administrator's email:
   ```bash
   INITIAL_ADMIN_EMAIL=lead.admin@company.com
   ```
   When that email signs in with Google for the very first time, the backend automatically flags their account as `role = 'admin'`.

   #### Method E: Local / Staging CLI Command
   ```bash
   cd backend
   PYTHONPATH=. ../.venv/bin/python -m app.cli set-role --email lead.admin@company.com --role admin
   PYTHONPATH=. ../.venv/bin/python -m app.cli list-users
   ```
3. **CORS & Domain Cookie Alignment**:
   - When deploying on AWS with an ALB:
     - Frontend URL: `https://app.claimspace.com`
     - Backend API URL: `https://api.claimspace.com` (or proxy via Next.js `/api/v1/:path*` rewrite to maintain same-origin).
   - If using domain cookies, set `SameSite=Lax`, `Secure=true`, and `domain=.claimspace.com` so both subdomains share the session seamlessly.
4. **Health Check Endpoints**:
   - Point your ALB Target Group health check to `GET /health` or `GET /` with a 30-second interval so healthy ECS tasks are kept in rotation.

---

## 6. Production Hardening: Preventing Unauthorized Role Access

To ensure nobody can bypass Google OAuth or grant themselves unauthorized admin privileges on AWS:

### 1. Automatic Frontend UI Hardening
In `frontend/src/app/login/page.tsx`, developer testing buttons ("Sign In as Admin (Dev)" and "Sign In as Policyholder (Dev)") are gated by:
```tsx
const isDevMode = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";
```
- **In Production Deployment**: Next.js automatically sets `NODE_ENV = "production"` during `next build`.
- **Result**: The entire instant testing panel is **stripped from the HTML/DOM**. Regular visitors and end users only see the official **"Continue with Google OAuth"** button.

### 2. Backend Endpoint Shutdown (`ALLOW_DEV_LOGIN=false`)
Even if someone attempts to craft a direct HTTP `POST /api/v1/auth/dev-login` via `curl` or Postman, the backend strictly rejects it:
- In your ECS Task Definition environment variables, set:
  ```json
  { "name": "ALLOW_DEV_LOGIN", "value": "false" }
  ```
- **Result**: When `ALLOW_DEV_LOGIN=false`, FastAPI immediately returns:
  ```json
  HTTP/1.1 404 Not Found
  { "detail": "Developer login endpoint is disabled in production" }
  ```

### 3. Strict Production Authorization Flow
- All users must authenticate through verified Google Accounts via `https://accounts.google.com`.
- New accounts automatically default to `role: "user"`.
- The Admin Console is only accessible to users whose emails were explicitly granted `admin` rights in the PostgreSQL `users` table.
