#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# create-store.sh  v1.0.0
# Deploy isolated POS instance on Google Cloud Run.
# One service per customer, one MongoDB per customer.
#
# Usage:
#   ./create-store.sh \
#     --store-name "ACME Repair" \
#     --subdomain "acme" \
#     --mongo-uri "mongodb+srv://user:pass@cluster.mongodb.net/acme-pos"
#
# Required:
#   --store-name   Customer-facing store name
#   --subdomain    URL-safe identifier (used as Cloud Run service name)
#   --mongo-uri    Dedicated MongoDB connection string
#
# Optional:
#   --domain       Custom domain (default: auto-detected Cloud Run URL)
#   --region       GCP region (default: europe-west3)
#   --project      GCP project ID (auto-detected from gcloud config)
#   --env-file     Extra env vars file (one per line, KEY=VALUE format)
#   --help         Show this help
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_VERSION="1.0.0"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}==>${NC} $1"; }
ok()    { echo -e "${GREEN}  ok${NC} $1"; }
warn()  { echo -e "${YELLOW} !!${NC} $1"; }
err()   { echo -e "${RED} !!${NC} $1" >&2; }

show_help() {
  tail -n +4 "$0" | sed -n '/^# \{1,2\}/s/^# \{1,2\}//p' | sed '/^$/q'
  echo ""
  echo "Options:"
  echo "  --store-name TEXT    Customer-facing store name (required)"
  echo "  --subdomain TEXT     URL-safe identifier, used as service name (required)"
  echo "  --mongo-uri URI      MongoDB connection string (required)"
  echo "  --domain TEXT        Custom domain (default: Cloud Run URL)"
  echo "  --region TEXT        GCP region (default: europe-west3)"
  echo "  --project TEXT       GCP project ID (default: gcloud config)"
  echo "  --env-file PATH      Extra env vars file (KEY=VALUE per line)"
  echo "  --build-id TEXT      Image tag override (default: timestamp)"
  echo "  --help               Show this help"
  exit 0
}

# ─── Parse args ─────────────────────────────────────────────────────────────
STORE_NAME=""; SUBDOMAIN=""; MONGO_URI=""
DOMAIN=""; REGION="europe-west3"; PROJECT_ID=""; ENV_FILE=""
BUILD_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --store-name) STORE_NAME="$2";  shift 2 ;;
    --subdomain)  SUBDOMAIN="$2";   shift 2 ;;
    --mongo-uri)  MONGO_URI="$2";   shift 2 ;;
    --domain)     DOMAIN="$2";      shift 2 ;;
    --region)     REGION="$2";      shift 2 ;;
    --project)    PROJECT_ID="$2";  shift 2 ;;
    --env-file)   ENV_FILE="$2";    shift 2 ;;
    --build-id)   BUILD_ID="$2";    shift 2 ;;
    --help)       show_help         ;;
    *) err "Unknown arg: $1"; show_help ;;
  esac
done

# ─── Validate required inputs ───────────────────────────────────────────────
if [[ -z "$STORE_NAME" || -z "$SUBDOMAIN" || -z "$MONGO_URI" ]]; then
  err "Missing required: --store-name, --subdomain, --mongo-uri"
  show_help
fi

command -v gcloud >/dev/null 2>&1 || { err "gcloud CLI not found"; exit 1; }
command -v openssl >/dev/null 2>&1 || { err "openssl not found"; exit 1; }

# Auto-detect GCP project
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
  if [[ -z "$PROJECT_ID" ]]; then
    err "No GCP project set. Use --project or: gcloud config set project PROJECT_ID"
    exit 1
  fi
fi

if [[ -n "$DOMAIN" ]]; then
  # Strip protocol prefix if user included it
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN#http://}"
fi

# ─── Sanitize service name ─────────────────────────────────────────────────
# Cloud Run rules: lowercase alphanum + hyphens, 1-63 chars
SERVICE_NAME=$(echo "$SUBDOMAIN" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//' \
  | cut -c1-63)

if [[ -z "$SERVICE_NAME" ]]; then
  err "Subdomain produced invalid service name. Use a-z, 0-9, hyphens."
  exit 1
fi

# ─── Generate secrets ───────────────────────────────────────────────────────
# Re-generate on each run. User can pin secrets via --env-file for re-deploy.
INV_JWT_SECRET=$(openssl rand -hex 32)
SAAS_JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)

# ─── Ensure Artifact Registry repo ──────────────────────────────────────────
ARTIFACT_REPO="cloud-run-source-deploy"
if ! gcloud artifacts repositories describe "$ARTIFACT_REPO" \
     --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  info "Creating Artifact Registry repo $ARTIFACT_REPO..."
  gcloud artifacts repositories create "$ARTIFACT_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID"
fi

# ─── Build & push Docker image ──────────────────────────────────────────────
BUILD_ID=${BUILD_ID:-$(date +%s)}
IMAGE="europe-west3-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$SERVICE_NAME:$BUILD_ID"

info "Building $SERVICE_NAME image via Cloud Build..."
gcloud builds submit \
  --tag "$IMAGE" \
  --project "$PROJECT_ID" \
  --machine-type=E2_HIGHCPU_8 \
  --timeout=1200 \
  . 2>&1 | tail -3
ok "Image pushed: $IMAGE"

# ─── Write env vars to temp YAML ───────────────────────────────────────────
ENV_YAML=$(mktemp)
cleanup() { rm -f "$ENV_YAML"; }
trap cleanup EXIT

cat > "$ENV_YAML" <<YAML
NODE_ENV: production
PORT: "8080"
STORE_NAME: "$STORE_NAME"
DOMAIN: "${DOMAIN:-$SERVICE_NAME}"
MONGO_URI: "$MONGO_URI"
DBCon: "$MONGO_URI"
INV_JWT_SECRET: "$INV_JWT_SECRET"
SAAS_JWT_SECRET: "$SAAS_JWT_SECRET"
SESSION_SECRET: "$SESSION_SECRET"
GOOGLE_ANALYTICS_ID: ""
PRINT_AGENT_URL: "http://localhost:9100"
COMPANY_NAME: "$STORE_NAME"
YAML

# Append extra vars from --env-file
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    key="${key#"${key%%[![:space:]]*}"}"   # trim leading whitespace
    key="${key%"${key##*[![:space:]]}"}"   # trim trailing
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#\"}"; value="${value%\"}"  # strip surrounding quotes
    echo "$key: \"$value\"" >> "$ENV_YAML"
  done < "$ENV_FILE"
  ok "Loaded $(grep -cEv '^\s*(#|$)' "$ENV_FILE" || true) extra vars from $ENV_FILE"
fi

# ─── Deploy to Cloud Run ────────────────────────────────────────────────────
info "Deploying $SERVICE_NAME to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --min-instances 0 \
  --timeout 300 \
  --env-vars-file "$ENV_YAML"

ok "Service $SERVICE_NAME deployed"

# ─── Fetch URL & update DOMAIN if not custom ────────────────────────────────
CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)')

if [[ -z "$DOMAIN" ]]; then
  DOMAIN_CLEAN="${CLOUD_RUN_URL#https://}"
  gcloud run services update "$SERVICE_NAME" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --update-env-vars "DOMAIN=$DOMAIN_CLEAN"
  ok "DOMAIN set to $DOMAIN_CLEAN"
fi

# ─── Output summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Store deployed successfully${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Store:       $STORE_NAME"
echo -e "  URL:         $CLOUD_RUN_URL"
echo -e "  Service:     $SERVICE_NAME"
echo -e "  Region:      $REGION"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Bootstrap admin user:"
echo -e "     gcloud run jobs create bootstrap-$SERVICE_NAME \\"
echo -e "       --image $IMAGE \\"
echo -e "       --region $REGION \\"
echo -e "       --command node \\"
echo -e "       --args scripts/bootstrap-users.js \\"
echo -e "       --set-env-vars DBCon=$MONGO_URI,INV_JWT_SECRET=...,ADMIN_PASSWORD=..."
echo ""
echo -e "  2. Map custom domain (optional):"
echo -e "     gcloud run domain-mappings create \\"
echo -e "       --service $SERVICE_NAME \\"
echo -e "       --domain yourstore.com \\"
echo -e "       --region $REGION"
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
