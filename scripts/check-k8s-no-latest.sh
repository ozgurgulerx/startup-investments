#!/bin/bash
# Guardrail: Kubernetes manifests must not use floating :latest tags.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v rg >/dev/null 2>&1; then
  MATCHES_CMD=(rg -n ":latest" infrastructure/kubernetes)
else
  MATCHES_CMD=(grep -RIn ":latest" infrastructure/kubernetes)
fi

if "${MATCHES_CMD[@]}"; then
  echo ""
  echo "ERROR: Found ':latest' image tags in infrastructure/kubernetes."
  echo "Use a pinned tag/digest (or __IMAGE_TAG__ placeholder patched by deploy tooling)."
  exit 1
fi

echo "OK: no ':latest' tags found in infrastructure/kubernetes."
