#!/usr/bin/env bash
# ==============================================================================
# Script: build_and_push_ecr.sh
# Purpose: Build and push ClaimSpace microservice images to Amazon ECR
# ==============================================================================
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
AWS_ACCOUNT_ID="${1:-}"

if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Usage: ./scripts/build_and_push_ecr.sh <AWS_ACCOUNT_ID> [AWS_REGION]"
    echo "Example: ./scripts/build_and_push_ecr.sh 123456789012 ap-south-1"
    exit 1
fi

ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ENV="prod"

echo "=== 1. Authenticating Docker with Amazon ECR ==="
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_BASE"

echo "=== 2. Building and Pushing Auth Microservice ==="
docker build --platform linux/arm64 -t "${ECR_BASE}/${ENV}-claimspace-auth-service:latest" ./auth_service
docker push "${ECR_BASE}/${ENV}-claimspace-auth-service:latest"

echo "=== 3. Building and Pushing Guided Tour Microservice ==="
docker build --platform linux/arm64 -t "${ECR_BASE}/${ENV}-claimspace-tour-service:latest" ./tour_service
docker push "${ECR_BASE}/${ENV}-claimspace-tour-service:latest"

echo "=== 4. Building and Pushing Next.js Frontend ==="
docker build --platform linux/arm64 -t "${ECR_BASE}/${ENV}-claimspace-frontend:latest" ./frontend
docker push "${ECR_BASE}/${ENV}-claimspace-frontend:latest"

echo "=== Done! All 3 microservice images pushed to ECR ==="
