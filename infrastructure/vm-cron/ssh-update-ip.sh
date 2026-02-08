#!/bin/bash
# ssh-update-ip.sh — Update the VM SSH NSG rules to allow your current IP.
#
# Why this exists:
# - VM access is locked down to an allowlisted public IP (NSG rule).
# - Your public IP can change; this script updates the rule(s) then optionally SSHes in.
#
# Usage:
#   ./infrastructure/vm-cron/ssh-update-ip.sh            # Update and SSH
#   ./infrastructure/vm-cron/ssh-update-ip.sh --no-ssh   # Update only
set -euo pipefail

RG="aistartuptr"
VM_NAME="vm-buildatlas-cron"
RULE_NAME="AllowSSH"

MY_IP="$(curl -s ifconfig.me)"
if [ -z "$MY_IP" ]; then
  echo "ERROR: Could not determine public IP"
  exit 1
fi
MY_CIDR="${MY_IP}/32"

VM_IP="$(az vm show -g "$RG" -n "$VM_NAME" --show-details --query publicIps -o tsv 2>/dev/null || true)"
if [ -z "$VM_IP" ] || [ "$VM_IP" = "None" ]; then
  # Fallback: keep a hardcoded IP if Azure query fails.
  VM_IP="20.90.104.162"
fi

NIC_ID="$(az vm show -g "$RG" -n "$VM_NAME" --query "networkProfile.networkInterfaces[0].id" -o tsv 2>/dev/null || true)"
if [ -z "$NIC_ID" ] || [ "$NIC_ID" = "None" ]; then
  echo "ERROR: Could not resolve NIC id for VM $VM_NAME"
  exit 1
fi

NIC_NSG_ID="$(az network nic show --ids "$NIC_ID" --query "networkSecurityGroup.id" -o tsv 2>/dev/null || true)"
SUBNET_ID="$(az network nic show --ids "$NIC_ID" --query "ipConfigurations[0].subnet.id" -o tsv 2>/dev/null || true)"
SUBNET_NSG_ID=""
if [ -n "$SUBNET_ID" ] && [ "$SUBNET_ID" != "None" ]; then
  SUBNET_NSG_ID="$(az network vnet subnet show --ids "$SUBNET_ID" --query "networkSecurityGroup.id" -o tsv 2>/dev/null || true)"
fi

id_to_name() {
  local id="$1"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    echo ""
    return 0
  fi
  basename "$id"
}

NIC_NSG="$(id_to_name "$NIC_NSG_ID")"
SUBNET_NSG="$(id_to_name "$SUBNET_NSG_ID")"

ensure_rule() {
  local nsg="$1"
  if [ -z "$nsg" ]; then
    return 0
  fi

  # If the rule exists, only update the source prefix.
  if az network nsg rule show -g "$RG" --nsg-name "$nsg" -n "$RULE_NAME" -o none 2>/dev/null; then
    local current=""
    current="$(az network nsg rule show -g "$RG" --nsg-name "$nsg" -n "$RULE_NAME" --query "sourceAddressPrefix" -o tsv 2>/dev/null || true)"
    if [ -z "$current" ] || [ "$current" = "None" ]; then
      current="$(az network nsg rule show -g "$RG" --nsg-name "$nsg" -n "$RULE_NAME" --query "sourceAddressPrefixes[0]" -o tsv 2>/dev/null || true)"
    fi
    current="${current:-none}"

    if [ "$current" = "$MY_CIDR" ]; then
      echo "NSG $nsg ($RULE_NAME) already allows $MY_IP"
      return 0
    fi

    echo "Updating NSG $nsg ($RULE_NAME): $current -> $MY_CIDR"
    az network nsg rule update -g "$RG" --nsg-name "$nsg" -n "$RULE_NAME" --source-address-prefixes "$MY_CIDR" -o none
    return 0
  fi

  # Otherwise create it with an available priority.
  local used=""
  used="$(az network nsg rule list -g "$RG" --nsg-name "$nsg" --query "[].priority" -o tsv 2>/dev/null || true)"
  local prio="1000"
  while echo "$used" | grep -qx "$prio" 2>/dev/null; do
    prio="$((prio + 10))"
  done

  echo "Creating NSG $nsg rule $RULE_NAME (priority $prio) for $MY_CIDR"
  az network nsg rule create -g "$RG" --nsg-name "$nsg" -n "$RULE_NAME" \
    --priority "$prio" \
    --direction Inbound \
    --access Allow \
    --protocol Tcp \
    --source-address-prefixes "$MY_CIDR" \
    --source-port-ranges '*' \
    --destination-address-prefixes '*' \
    --destination-port-ranges 22 \
    -o none
}

echo "Public IP: $MY_IP"
echo "VM: $VM_NAME ($VM_IP)"
echo "NIC NSG: ${NIC_NSG:-none}"
echo "Subnet NSG: ${SUBNET_NSG:-none}"

ensure_rule "$NIC_NSG"
ensure_rule "$SUBNET_NSG"

if [ "${1:-}" != "--no-ssh" ]; then
  echo "Connecting..."
  ssh buildatlas@"$VM_IP"
fi

