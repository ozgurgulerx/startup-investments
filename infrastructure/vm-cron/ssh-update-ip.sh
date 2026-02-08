#!/bin/bash
# ssh-update-ip.sh — Update the VM SSH NSG rules to allow your current IP.
# Run this whenever your IP changes, or before SSH'ing in.
#
# Usage:
#   ./infrastructure/vm-cron/ssh-update-ip.sh        # Update and SSH
#   ./infrastructure/vm-cron/ssh-update-ip.sh --no-ssh  # Update only
set -euo pipefail

RG="aistartuptr"
NIC_NSG="vm-buildatlas-cronNSG"
SUBNET_NSG="vm-buildatlas-cronVNET-vm-buildatlas-cronSubnet-nsg-uksouth"
VM_IP="20.90.104.162"
RULE_NAME="AllowSSH"

# Get current public IP
MY_IP=$(curl -s ifconfig.me)
if [ -z "$MY_IP" ]; then
    echo "ERROR: Could not determine public IP"
    exit 1
fi

# Get current allowed IP from NIC NSG
CURRENT_IP=$(az network nsg rule show --nsg-name "$NIC_NSG" -g "$RG" -n "$RULE_NAME" \
    --query "sourceAddressPrefix" -o tsv 2>/dev/null || echo "none")

if [ "$CURRENT_IP" = "${MY_IP}/32" ]; then
    echo "SSH rule already allows $MY_IP"
else
    echo "Updating SSH rules: $CURRENT_IP → ${MY_IP}/32"

    # Update both NSGs in parallel
    az network nsg rule update --nsg-name "$NIC_NSG" -g "$RG" -n "$RULE_NAME" \
        --source-address-prefixes "${MY_IP}/32" -o none &
    az network nsg rule update --nsg-name "$SUBNET_NSG" -g "$RG" -n "$RULE_NAME" \
        --source-address-prefixes "${MY_IP}/32" -o none &
    wait
    echo "Updated both NSG rules to allow ${MY_IP}"
fi

if [ "${1:-}" != "--no-ssh" ]; then
    echo "Connecting..."
    ssh buildatlas@"$VM_IP"
fi
