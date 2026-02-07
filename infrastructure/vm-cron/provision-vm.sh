#!/bin/bash
# provision-vm.sh — Create Azure B2s VM with managed identity for BuildAtlas cron jobs.
#
# Prerequisites: Azure CLI logged in (az login).
# Usage: bash provision-vm.sh [--ssh-source-ip YOUR_IP]
set -euo pipefail

RESOURCE_GROUP="aistartuptr"
VM_NAME="vm-buildatlas-cron"
LOCATION="eastus"
VM_SIZE="Standard_B2s"
IMAGE="Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest"
ADMIN_USER="buildatlas"
OS_DISK_SIZE=30

# Parse optional SSH source IP
SSH_SOURCE_IP="${1:-}"
if [ "$SSH_SOURCE_IP" = "--ssh-source-ip" ]; then
    SSH_SOURCE_IP="${2:?Missing IP after --ssh-source-ip}"
elif [[ "$SSH_SOURCE_IP" == --ssh-source-ip=* ]]; then
    SSH_SOURCE_IP="${SSH_SOURCE_IP#*=}"
else
    SSH_SOURCE_IP=""
fi

echo "=== Provisioning BuildAtlas Cron VM ==="
echo "  Resource Group: $RESOURCE_GROUP"
echo "  VM Name:        $VM_NAME"
echo "  Size:           $VM_SIZE"
echo "  Region:         $LOCATION"
echo ""

# --- Step 1: Create the VM ---
echo "[1/4] Creating VM..."
az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --image "$IMAGE" \
    --size "$VM_SIZE" \
    --admin-username "$ADMIN_USER" \
    --generate-ssh-keys \
    --assign-identity '[system]' \
    --public-ip-sku Standard \
    --os-disk-size-gb "$OS_DISK_SIZE" \
    --storage-sku StandardSSD_LRS \
    --location "$LOCATION" \
    --output table

# Disable auto-shutdown (this VM must run 24/7)
echo "Disabling auto-shutdown..."
az vm auto-shutdown --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --off 2>/dev/null || true

# --- Step 2: Get managed identity principal ID ---
echo ""
echo "[2/4] Getting managed identity..."
PRINCIPAL_ID=$(az vm show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --query 'identity.principalId' -o tsv)
echo "  Principal ID: $PRINCIPAL_ID"

SUBSCRIPTION_ID=$(az account show --query 'id' -o tsv)
echo "  Subscription: $SUBSCRIPTION_ID"

# --- Step 3: Assign RBAC roles ---
echo ""
echo "[3/4] Assigning RBAC roles..."

# AKS: Cluster User + Contributor (to check state and start cluster)
echo "  - Azure Kubernetes Service Cluster User Role..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Azure Kubernetes Service Cluster User Role" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerService/managedClusters/aks-aistartuptr" \
    --output none 2>/dev/null || echo "    (already assigned)"

echo "  - Contributor on AKS..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Contributor" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerService/managedClusters/aks-aistartuptr" \
    --output none 2>/dev/null || echo "    (already assigned)"

# Storage: Blob Data Reader
echo "  - Storage Blob Data Reader on buildatlasstorage..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Storage Blob Data Reader" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/buildatlasstorage" \
    --output none 2>/dev/null || echo "    (already assigned)"

# PostgreSQL: Reader on resource group + Contributor on the server
echo "  - Reader on aistartupstr resource group..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Reader" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/aistartupstr" \
    --output none 2>/dev/null || echo "    (already assigned)"

echo "  - Contributor on PostgreSQL server..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Contributor" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/aistartupstr/providers/Microsoft.DBforPostgreSQL/flexibleServers/aistartupstr" \
    --output none 2>/dev/null || echo "    (already assigned)"

# App Service: Contributor (to deploy frontend)
echo "  - Contributor on App Service (buildatlas-web)..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "Contributor" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-startup-analysis/providers/Microsoft.Web/sites/buildatlas-web" \
    --output none 2>/dev/null || echo "    (already assigned)"

# ACR: AcrPush (to build and push Docker images for backend)
echo "  - AcrPush on ACR (aistartuptr)..."
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "AcrPush" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/aistartuptr" \
    --output none 2>/dev/null || echo "    (already assigned)"

# --- Step 4: NSG rule to restrict SSH ---
echo ""
echo "[4/4] Configuring network security..."
if [ -n "$SSH_SOURCE_IP" ]; then
    NSG_NAME=$(az vm show --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
        --query 'networkProfile.networkInterfaces[0].id' -o tsv | xargs -I{} az network nic show --ids {} \
        --query 'networkSecurityGroup.id' -o tsv | xargs -I{} basename {})

    if [ -n "$NSG_NAME" ]; then
        echo "  Restricting SSH to $SSH_SOURCE_IP..."
        az network nsg rule update \
            --resource-group "$RESOURCE_GROUP" \
            --nsg-name "$NSG_NAME" \
            --name "default-allow-ssh" \
            --source-address-prefixes "$SSH_SOURCE_IP" \
            --output none 2>/dev/null || echo "    (rule update failed, check manually)"
    fi
else
    echo "  WARNING: SSH is open to all. Use --ssh-source-ip YOUR_IP to restrict."
fi

# --- Print connection info ---
VM_IP=$(az vm show --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
    --show-details --query 'publicIps' -o tsv)

echo ""
echo "=========================================="
echo "  VM provisioned successfully!"
echo "=========================================="
echo ""
echo "  SSH:  ssh $ADMIN_USER@$VM_IP"
echo ""
echo "  Next steps:"
echo "    1. SSH into the VM"
echo "    2. Copy setup.sh to the VM and run it"
echo "    3. Create /etc/buildatlas/.env (see .env.example)"
echo "    4. The crontab is installed automatically by setup.sh"
echo ""
echo "  Quick setup:"
echo "    scp infrastructure/vm-cron/setup.sh $ADMIN_USER@$VM_IP:~/"
echo "    ssh $ADMIN_USER@$VM_IP 'bash ~/setup.sh'"
echo ""
