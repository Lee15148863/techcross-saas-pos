#!/bin/bash

# 手动触发 Google Cloud Build 部署
# 使用方法: bash trigger-deploy.sh

echo "🚀 开始部署到 Google Cloud Run..."
echo ""

# 获取当前 Git commit SHA
COMMIT_SHA=$(git rev-parse --short HEAD)
echo "📦 当前版本: $COMMIT_SHA"
echo ""

# 触发 Cloud Build
echo "⏳ 正在触发 Cloud Build..."
gcloud builds submit --config=cloudbuild.yaml .

echo ""
echo "✅ 部署完成！"
echo "🌐 网站地址: https://teschcross-1045728849939.europe-west3.run.app"
