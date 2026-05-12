# 手动触发 Google Cloud Build 部署
# 使用方法: .\trigger-deploy.ps1

Write-Host "🚀 开始部署到 Google Cloud Run..." -ForegroundColor Green
Write-Host ""

# 获取当前 Git commit SHA
$COMMIT_SHA = git rev-parse --short HEAD
Write-Host "📦 当前版本: $COMMIT_SHA" -ForegroundColor Cyan
Write-Host ""

# 触发 Cloud Build
Write-Host "⏳ 正在触发 Cloud Build..." -ForegroundColor Yellow
gcloud builds submit --config=cloudbuild.yaml .

Write-Host ""
Write-Host "✅ 部署完成！" -ForegroundColor Green
Write-Host "🌐 网站地址: https://teschcross-1045728849939.europe-west3.run.app" -ForegroundColor Cyan
