# Lightweight AWS Deployment Architecture

This architecture outlines the standalone, cost-optimized deployment of **ClaimSpace** on AWS ECS Fargate, routing traffic via an Application Load Balancer (ALB) directly to the decoupled microservices.

```mermaid
flowchart TD
    subgraph Internet ["Public Internet"]
        Client["Browser Client"]
    end

    subgraph AWS ["AWS Cloud (VPC)"]
        ALB["Application Load Balancer (HTTPS Port 443 / HTTP 80)"]
        
        subgraph PublicSubnets ["Public Subnets (2 AZs)"]
            NAT["NAT Gateway"]
            IGW["Internet Gateway"]
        end

        subgraph PrivateSubnets ["Private Subnets (2 AZs)"]
            subgraph ECSCluster ["ECS Fargate Cluster"]
                Frontend["claimspace-frontend\n(Port 3000, 0.25 vCPU, 512MB)"]
                AuthSvc["claimspace-auth-service\n(Port 8002, 0.25 vCPU, 256MB)"]
                TourSvc["claimspace-tour-service\n(Port 8001, 0.25 vCPU, 256MB)"]
            end

            RDS[("Amazon RDS PostgreSQL\n(db.t4g.micro)\nusers table")]
        end

        SSM["AWS SSM Parameter Store\n• JWT Secret\n• Google OAuth Credentials\n• Database URL"]
    end

    Client -->|HTTPS| ALB
    ALB -->|Priority 10: /api/v1/auth/*| AuthSvc
    ALB -->|Priority 20: /api/v1/tour/*| TourSvc
    ALB -->|Priority 100:| Frontend

    AuthSvc --> RDS
    AuthSvc -.-> SSM
    Frontend -.-> SSM
```