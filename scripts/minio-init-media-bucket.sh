#!/usr/bin/env bash
# Create the shared S3 bucket in MinIO (run after `pnpm docker:up`).
# Endpoint: S3_ENDPOINT or MINIO_ENDPOINT (default http://127.0.0.1:9000).
set -euo pipefail
ENDPOINT="${S3_ENDPOINT:-${MINIO_ENDPOINT:-http://127.0.0.1:9000}}"
BUCKET="${S3_BUCKET:-openad-media}"
export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}"
export AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}"
export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found; install awscli to run this script." >&2
  exit 1
fi

aws --endpoint-url="$ENDPOINT" s3api create-bucket --bucket "$BUCKET" 2>/dev/null || true
echo "Bucket ready: s3://$BUCKET (MinIO API $ENDPOINT)"
echo "Console (embedded UI, pinned MinIO image): http://127.0.0.1:${MINIO_CONSOLE_PORT:-9001} — login with same keys as S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY"
