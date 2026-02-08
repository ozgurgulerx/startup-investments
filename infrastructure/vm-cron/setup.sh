#!/bin/bash
# setup.sh — One-time VM setup for BuildAtlas cron jobs.
# Run as the 'buildatlas' user on the provisioned VM.
set -euo pipefail

REPO_URL="https://github.com/ozgurgulerx/startup-investments.git"
REPO_DIR="/opt/buildatlas/startup-analysis"
VENV_DIR="/opt/buildatlas/venv"
LOG_DIR="/var/log/buildatlas"
ENV_DIR="/etc/buildatlas"

echo "=== BuildAtlas VM Setup ==="
echo ""

# --- System packages ---
echo "[1/8] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    software-properties-common curl git jq unzip logrotate \
    cron \
    build-essential libffi-dev libssl-dev \
    apt-transport-https ca-certificates gnupg lsb-release \
    util-linux zip rsync

# Ensure cron daemon is enabled and running
sudo systemctl enable --now cron 2>/dev/null || true

# --- Python 3.11 ---
echo ""
echo "[2/8] Installing Python 3.11..."
sudo add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
sudo apt-get update -qq
sudo apt-get install -y -qq python3.11 python3.11-venv python3.11-dev

# --- Node.js 20 ---
echo ""
echo "[3/8] Installing Node.js 20..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
fi
sudo npm install -g pnpm@8 2>/dev/null || true

# --- Azure CLI ---
echo ""
echo "[4/8] Installing Azure CLI..."
if ! command -v az &>/dev/null; then
    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
fi

# kubectl
echo "Installing kubectl..."
sudo az aks install-cli 2>/dev/null || true

# Login with managed identity
echo "Logging in with managed identity..."
az login --identity --output none

# Get AKS credentials
echo "Getting AKS credentials..."
az aks get-credentials --resource-group aistartuptr --name aks-aistartuptr --overwrite-existing

# --- Playwright system dependencies ---
echo ""
echo "[5/8] Installing Playwright/Chromium dependencies..."
sudo apt-get install -y -qq \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 2>/dev/null || true

# --- Directory structure ---
echo ""
echo "[6/8] Creating directories..."
sudo mkdir -p /opt/buildatlas
sudo mkdir -p "$ENV_DIR"
sudo mkdir -p "$LOG_DIR"
sudo chown "$(whoami):$(whoami)" /opt/buildatlas "$LOG_DIR"

# --- Clone repo ---
echo ""
echo "[7/8] Cloning repository..."
if [ -d "$REPO_DIR" ]; then
    echo "  Repo already exists, pulling latest..."
    cd "$REPO_DIR" && git pull --ff-only origin main
else
    git clone "$REPO_URL" "$REPO_DIR"
fi

# --- Python venv ---
echo ""
echo "[8/8] Setting up Python virtual environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3.11 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$REPO_DIR/packages/analysis/requirements.txt" -q
"$VENV_DIR/bin/python" -m playwright install chromium 2>/dev/null || true

# --- Node dependencies ---
echo "Installing Node.js dependencies..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Logrotate ---
echo "Installing logrotate config..."
sudo cp "$REPO_DIR/infrastructure/vm-cron/logrotate.conf" /etc/logrotate.d/buildatlas

# --- Make scripts executable ---
echo "Making scripts executable..."
chmod +x "$REPO_DIR/infrastructure/vm-cron/"*.sh
chmod +x "$REPO_DIR/infrastructure/vm-cron/lib/"*.sh
chmod +x "$REPO_DIR/infrastructure/vm-cron/jobs/"*.sh
chmod +x "$REPO_DIR/infrastructure/vm-cron/monitoring/"*.sh

# --- Install crontab ---
echo "Installing crontab..."
# crontab(5) is sensitive to CRLF; strip CR characters defensively.
tr -d '\r' < "$REPO_DIR/infrastructure/vm-cron/crontab" | crontab -

echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
echo "  Next: Create /etc/buildatlas/.env with required secrets."
echo "  Template: $REPO_DIR/infrastructure/vm-cron/.env.example"
echo ""
echo "  sudo cp $REPO_DIR/infrastructure/vm-cron/.env.example $ENV_DIR/.env"
echo "  sudo nano $ENV_DIR/.env    # fill in secrets"
echo "  sudo chmod 600 $ENV_DIR/.env"
echo "  sudo chown $(whoami):$(whoami) $ENV_DIR/.env"
echo ""
echo "  Verify crontab:  crontab -l"
echo "  Check logs:      ls -la $LOG_DIR/"
echo ""
