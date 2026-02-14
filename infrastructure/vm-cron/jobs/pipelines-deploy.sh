#!/bin/bash
# pipelines-deploy.sh — Build pipeline/ops Docker images and deploy AKS CronJobs.
#
# Called by deploy.sh when pipeline-related code changes, or manually via:
#   runner.sh pipelines-deploy 30 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/pipelines-deploy.sh
#
# Uses `az acr build` (remote build on ACR — no local Docker needed).
# Requires: Azure CLI (logged in), kubectl (AKS credentials)
# Env vars sourced from /etc/buildatlas/.env by runner.sh
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
ACR_NAME="aistartuptr"
AKS_CLUSTER_NAME="aks-aistartuptr"
AKS_RESOURCE_GROUP="aistartuptr"
NAMESPACE="${NAMESPACE:-default}"
PIPELINES_IMAGE_NAME="buildatlas-pipelines"
OPS_IMAGE_NAME="buildatlas-ops"
PLAYWRIGHT_CANARY_IMAGE_NAME="buildatlas-playwright-canary"

COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
PIPELINES_FULL_IMAGE="$ACR_NAME.azurecr.io/$PIPELINES_IMAGE_NAME"
PIPELINES_DEPLOY_IMAGE="$PIPELINES_FULL_IMAGE:$COMMIT_SHA"

OPS_FULL_IMAGE="$ACR_NAME.azurecr.io/$OPS_IMAGE_NAME"
OPS_DEPLOY_IMAGE="$OPS_FULL_IMAGE:$COMMIT_SHA"

PLAYWRIGHT_CANARY_FULL_IMAGE="$ACR_NAME.azurecr.io/$PLAYWRIGHT_CANARY_IMAGE_NAME"
PLAYWRIGHT_CANARY_DEPLOY_IMAGE="$PLAYWRIGHT_CANARY_FULL_IMAGE:$COMMIT_SHA"

TEMP_DIR="$(mktemp -d /tmp/buildatlas-pipelines-deploy.XXXXXX)"
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Avoid clobbering shared kubeconfig state (deploy.sh can run deploys in parallel).
export KUBECONFIG="$TEMP_DIR/kubeconfig"

echo "=== Pipelines Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Commit: $COMMIT_SHA"
echo "  Namespace: $NAMESPACE"
echo "  Pipelines image: $PIPELINES_DEPLOY_IMAGE"
echo "  Ops image: $OPS_DEPLOY_IMAGE"
echo "  Canary image: $PLAYWRIGHT_CANARY_DEPLOY_IMAGE"
echo ""

# Azure CLI login (managed identity)
az_login() {
    for i in 1 2 3; do
        if az login --identity --output none 2>/dev/null; then
            return 0
        fi
        sleep 2
    done
    return 1
}
if ! az_login; then
    echo "ERROR: Azure managed identity login failed"
    exit 1
fi

# --- Step 1: Validate required env vars ---
echo "[1/5] Validating environment..."

# Back-compat mappings + safe defaults (keep secrets consistent across VM + AKS).
if [ -z "${SLACK_WEBHOOK_URL:-}" ] && [ -n "${SLACK_WEBHOOK:-}" ]; then
    export SLACK_WEBHOOK_URL="$SLACK_WEBHOOK"
fi
if [ -z "${AZURE_OPENAI_DEPLOYMENT_NAME:-}" ] && [ -n "${AZURE_OPENAI_DEPLOYMENT:-}" ]; then
    export AZURE_OPENAI_DEPLOYMENT_NAME="$AZURE_OPENAI_DEPLOYMENT"
fi
if [ -z "${AZURE_OPENAI_EMBEDDING_DEPLOYMENT:-}" ]; then
    export AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
fi

for KEY in \
    DATABASE_URL \
    SLACK_WEBHOOK_URL \
    API_URL \
    API_KEY \
    ADMIN_KEY \
    RESEND_API_KEY \
    NEWS_DIGEST_FROM_EMAIL \
    PUBLIC_BASE_URL \
    AZURE_OPENAI_ENDPOINT \
    AZURE_OPENAI_DEPLOYMENT_NAME; do
    if [ -z "${!KEY:-}" ]; then
        echo "ERROR: Missing required env var: $KEY"
        exit 1
    fi
done

if [ -z "${METRICS_REPORT_EMAIL_TO:-}" ]; then
    echo "  NOTE: METRICS_REPORT_EMAIL_TO not set; onboarding EOD report email will be skipped."
fi
echo "  OK"

# --- Step 2: Build and push images via ACR ---
echo ""
echo "[2/5] Building pipelines Docker image on ACR..."
az acr build \
    --registry "$ACR_NAME" \
    --image "$PIPELINES_IMAGE_NAME:$COMMIT_SHA" \
    --image "$PIPELINES_IMAGE_NAME:latest" \
    --file infrastructure/pipelines/Dockerfile \
    "$REPO_DIR"

echo "  Pushed: $PIPELINES_FULL_IMAGE:$COMMIT_SHA"
echo "  Pushed: $PIPELINES_FULL_IMAGE:latest"

OPS_OK=1
echo ""
echo "[2.1/5] Building ops Docker image on ACR (best effort)..."
if ! az acr build \
    --registry "$ACR_NAME" \
    --image "$OPS_IMAGE_NAME:$COMMIT_SHA" \
    --image "$OPS_IMAGE_NAME:latest" \
    --file infrastructure/ops/Dockerfile \
    "$REPO_DIR"; then
    echo "  WARNING: ops image build failed; ops cronjobs will not be updated."
    OPS_OK=0
else
    echo "  Pushed: $OPS_FULL_IMAGE:$COMMIT_SHA"
    echo "  Pushed: $OPS_FULL_IMAGE:latest"
fi

CANARY_OK=1
echo ""
echo "[2.2/5] Building Playwright canary Docker image on ACR (best effort)..."
if ! az acr build \
    --registry "$ACR_NAME" \
    --image "$PLAYWRIGHT_CANARY_IMAGE_NAME:$COMMIT_SHA" \
    --image "$PLAYWRIGHT_CANARY_IMAGE_NAME:latest" \
    --file infrastructure/ops/playwright-canary/Dockerfile \
    "$REPO_DIR"; then
    echo "  WARNING: canary image build failed; canary cronjob will not be updated."
    CANARY_OK=0
else
    echo "  Pushed: $PLAYWRIGHT_CANARY_FULL_IMAGE:$COMMIT_SHA"
    echo "  Pushed: $PLAYWRIGHT_CANARY_FULL_IMAGE:latest"
fi

# --- Step 3: Ensure AKS is running ---
echo ""
echo "[3/5] Checking AKS state..."
aks_power_state() {
    az aks show -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --query powerState.code -o tsv 2>/dev/null || echo UNKNOWN
}

AKS_STATE="$(aks_power_state)"
AKS_STATE="$(echo "$AKS_STATE" | tr -d '\r\n')"
if [ -z "$AKS_STATE" ]; then
    AKS_STATE="UNKNOWN"
fi
echo "  AKS power state: $AKS_STATE"

if [ "$AKS_STATE" = "Stopped" ]; then
    echo "  Starting AKS..."
    az aks start -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME"
fi

for i in $(seq 1 60); do
    AKS_STATE="$(aks_power_state)"
    AKS_STATE="$(echo "$AKS_STATE" | tr -d '\r\n')"
    if [ -z "$AKS_STATE" ]; then
        AKS_STATE="UNKNOWN"
    fi

    # Some Azure control-plane responses can intermittently omit powerState even when the
    # Kubernetes API is already reachable. Prefer a connectivity check over sleeping out
    # the deploy window.
    if az aks get-credentials -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --file "$KUBECONFIG" --overwrite-existing >/dev/null 2>&1; then
        if kubectl --request-timeout=10s get nodes >/dev/null 2>&1; then
            echo "  AKS is Running (kubectl reachable)."
            AKS_STATE="Running"
            break
        fi
    fi

    if [ "$AKS_STATE" = "Running" ]; then
        echo "  AKS is Running."
        break
    fi

    if [ "$AKS_STATE" = "Stopped" ]; then
        echo "  Starting AKS..."
        az aks start -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME"
    fi

    echo "  Waiting for AKS (attempt $i, state=$AKS_STATE)..."
    sleep 10
done

if [ "$AKS_STATE" != "Running" ]; then
    echo "ERROR: AKS did not reach Running state (state=$AKS_STATE)"
    exit 1
fi

az aks get-credentials -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --file "$KUBECONFIG" --overwrite-existing

# --- Step 4: Apply config + CronJobs (pinned tag) ---
echo ""
echo "[4/5] Applying pipelines config + CronJobs..."

# Create/update pipelines secrets from the VM env (source of truth: /etc/buildatlas/.env).
# NOTE: `kubectl create secret --from-env-file` does not parse shell quoting; do not include surrounding quotes.
PIPELINES_ENV_FILE="$TEMP_DIR/buildatlas-pipelines-secrets.env"
cat >"$PIPELINES_ENV_FILE" <<EOF
DATABASE_URL=${DATABASE_URL}
SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
API_URL=${API_URL}
API_KEY=${API_KEY}
ADMIN_KEY=${ADMIN_KEY}
RESEND_API_KEY=${RESEND_API_KEY}
NEWS_DIGEST_FROM_EMAIL=${NEWS_DIGEST_FROM_EMAIL}
NEWS_DIGEST_REPLY_TO=${NEWS_DIGEST_REPLY_TO:-}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
METRICS_REPORT_EMAIL_TO=${METRICS_REPORT_EMAIL_TO:-}
METRICS_REPORT_EMAIL_FROM=${METRICS_REPORT_EMAIL_FROM:-}
METRICS_REPORT_EMAIL_SUBJECT_PREFIX=${METRICS_REPORT_EMAIL_SUBJECT_PREFIX:-}
ONBOARDING_EOD_REPORT_EMAIL_SUBJECT_PREFIX=${ONBOARDING_EOD_REPORT_EMAIL_SUBJECT_PREFIX:-}
ONBOARDING_EOD_REPORT_EMAIL_MAX_CHARS=${ONBOARDING_EOD_REPORT_EMAIL_MAX_CHARS:-}
AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}
AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY:-}
AZURE_OPENAI_DEPLOYMENT_NAME=${AZURE_OPENAI_DEPLOYMENT_NAME}
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
AZURE_STORAGE_CONNECTION_STRING=${AZURE_STORAGE_CONNECTION_STRING:-}
# Optional: X/Twitter credentials (jobs will skip if absent)
X_API_BEARER_TOKEN=${X_API_BEARER_TOKEN:-}
X_API_KEY=${X_API_KEY:-}
X_API_SECRET=${X_API_SECRET:-}
X_ACCESS_TOKEN=${X_ACCESS_TOKEN:-}
X_ACCESS_TOKEN_SECRET=${X_ACCESS_TOKEN_SECRET:-}
EOF
chmod 600 "$PIPELINES_ENV_FILE" || true

kubectl create secret generic buildatlas-pipelines-secrets \
    -n "$NAMESPACE" \
    --from-env-file="$PIPELINES_ENV_FILE" \
    --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -n "$NAMESPACE" -f "$REPO_DIR/infrastructure/kubernetes/pipelines-configmap.yaml"

RENDERED_CRONJOBS="$TEMP_DIR/pipelines-cronjobs.rendered.yaml"
sed "s/__IMAGE_TAG__/${COMMIT_SHA}/g" \
    "$REPO_DIR/infrastructure/kubernetes/pipelines-cronjobs.yaml" > "$RENDERED_CRONJOBS"

kubectl apply -n "$NAMESPACE" -f "$RENDERED_CRONJOBS"

# --- Ops CronJobs (best effort) ---
if [ "$OPS_OK" = "1" ] || [ "$CANARY_OK" = "1" ]; then
    echo ""
    echo "[4.1/5] Applying ops CronJobs (best effort)..."

    if ! kubectl get secret -n "$NAMESPACE" buildatlas-ops-secrets >/dev/null 2>&1; then
        echo "  WARNING: Missing Kubernetes secret: buildatlas-ops-secrets (skipping ops cronjobs)."
    else
        if [ "$OPS_OK" = "1" ]; then
            for f in posthog-usage-cronjob.yaml posthog-exceptions-cronjob.yaml; do
                src="$REPO_DIR/infrastructure/kubernetes/$f"
                out="$TEMP_DIR/${f%.yaml}.rendered.yaml"
                sed "s/__IMAGE_TAG__/${COMMIT_SHA}/g" "$src" > "$out"
                kubectl apply -n "$NAMESPACE" -f "$out"
            done
        fi

        if [ "$CANARY_OK" = "1" ]; then
            src="$REPO_DIR/infrastructure/kubernetes/playwright-canary-cronjob.yaml"
            out="$TEMP_DIR/playwright-canary-cronjob.rendered.yaml"
            sed "s/__IMAGE_TAG__/${COMMIT_SHA}/g" "$src" > "$out"
            kubectl apply -n "$NAMESPACE" -f "$out"
        fi
    fi
fi

# --- Step 5: Quick sanity checks ---
echo ""
echo "[5/5] Verifying CronJobs reference pinned image..."
report="$(kubectl get cronjobs -n "$NAMESPACE" -l app=buildatlas-pipelines -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null || true)"
if [ -z "$report" ]; then
    echo "WARNING: could not list buildatlas-pipelines CronJobs."
else
    echo "$report"
    if echo "$report" | awk -v img="$PIPELINES_DEPLOY_IMAGE" '$2 != img {exit 1}'; then
        echo "  OK: all buildatlas-pipelines CronJobs pinned to $PIPELINES_DEPLOY_IMAGE"
    else
        echo "WARNING: some buildatlas-pipelines CronJobs are not pinned to $PIPELINES_DEPLOY_IMAGE"
        echo ""
        echo "Mismatches:"
        echo "$report" | awk -v img="$PIPELINES_DEPLOY_IMAGE" '$2 != img {print "  " $0}'
    fi
fi

if kubectl get secret -n "$NAMESPACE" buildatlas-ops-secrets >/dev/null 2>&1; then
    if [ "$OPS_OK" = "1" ]; then
        kubectl get cronjobs -n "$NAMESPACE" posthog-usage-summary posthog-exceptions-alerts -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null \
          | grep -F "$OPS_DEPLOY_IMAGE" >/dev/null \
          || echo "WARNING: ops cronjobs may still reference a different buildatlas-ops tag."
    fi
    if [ "$CANARY_OK" = "1" ]; then
        kubectl get cronjobs -n "$NAMESPACE" browser-canary-landscapes -o jsonpath='{.spec.jobTemplate.spec.template.spec.containers[0].image}' 2>/dev/null \
          | grep -F "$PLAYWRIGHT_CANARY_DEPLOY_IMAGE" >/dev/null \
          || echo "WARNING: browser-canary-landscapes may still reference a different buildatlas-playwright-canary tag."
    fi
fi

echo ""
echo "Pipelines deploy complete at $(date -u '+%Y-%m-%d %H:%M UTC')"
