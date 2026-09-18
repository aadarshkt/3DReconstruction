#!/usr/bin/env bash
# ==============================================================================
# Script: smoke_test_aws.sh
# Purpose: Health check and ingress verification for AWS ALB deployment
# ==============================================================================
set -euo pipefail

TARGET_HOST="${1:-}"

if [ -z "$TARGET_HOST" ]; then
    echo "Usage: ./scripts/smoke_test_aws.sh <ALB_DNS_NAME_OR_DOMAIN>"
    echo "Example: ./scripts/smoke_test_aws.sh prod-claimspace-alb-123456789.us-east-1.elb.amazonaws.com"
    exit 1
fi

BASE_URL="http://${TARGET_HOST}"

echo "========================================="
echo " ClaimSpace AWS Deployment Smoke Test"
echo " Target: ${BASE_URL}"
echo "========================================="

echo ""
echo "--- 1. Testing Auth Microservice Health (/api/v1/auth/health) ---"
AUTH_HEALTH=$(curl -sf "${BASE_URL}/api/v1/auth/health" || echo "FAILED")
echo "Response: $AUTH_HEALTH"
if [[ "$AUTH_HEALTH" == *"claimspace-auth-microservice"* ]]; then
    echo "✅ Auth Microservice is HEALTHY"
else
    echo "❌ Auth Microservice FAILED"
fi

echo ""
echo "--- 2. Testing Guided Tour Microservice Health (/api/v1/tour/health) ---"
TOUR_HEALTH=$(curl -sf "${BASE_URL}/api/v1/tour/health" || echo "FAILED")
echo "Response: $TOUR_HEALTH"
if [[ "$TOUR_HEALTH" == *"guided-tour-microservice"* ]]; then
    echo "✅ Guided Tour Microservice is HEALTHY"
else
    echo "❌ Guided Tour Microservice FAILED"
fi

echo ""
echo "--- 3. Testing Next.js Frontend Ingress (/) ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/")
echo "HTTP Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ Next.js Frontend is UP and SERVING"
else
    echo "❌ Frontend returned non-200 status code: $HTTP_STATUS"
fi

echo ""
echo "--- 4. Testing Static 3D Artifact Streaming ---"
PLY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/tour/artifacts/point_cloud.ply")
SVG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/tour/artifacts/floor_plan.svg")
echo "Point Cloud PLY Status: $PLY_STATUS"
echo "Floor Plan SVG Status: $SVG_STATUS"
if [ "$PLY_STATUS" -eq 200 ] && [ "$SVG_STATUS" -eq 200 ]; then
    echo "✅ 3D and Vector Artifacts Streaming HEALTHY"
else
    echo "❌ Artifact retrieval check failed"
fi

echo ""
echo "--- 5. Testing Google OAuth Configuration Endpoint ---"
GOOGLE_CONFIG=$(curl -sf "${BASE_URL}/api/v1/auth/google/url" || echo "FAILED")
echo "Response: $GOOGLE_CONFIG"
if [[ "$GOOGLE_CONFIG" == *"accounts.google.com"* ]]; then
    echo "✅ Google OAuth 2.0 Ingress is READY"
else
    echo "❌ Google OAuth configuration check failed"
fi

echo ""
echo "========================================="
echo " Smoke Test Complete!"
echo "========================================="
