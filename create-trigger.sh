#!/bin/bash

# 创建正确的Cloud Build触发器
# 使用此脚本自动创建触发器，避免手动配置错误

gcloud builds triggers create github \
  --name="teschcross-auto-deploy" \
  --repo-name="teschcross" \
  --repo-owner="Lee15148863" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --region="europe-west3" \
  --description="Auto deploy Tech Cross website to Cloud Run"

echo "✅ 触发器创建成功！"
echo "现在每次推送到main分支，都会自动部署，不需要手动选择镜像。"
