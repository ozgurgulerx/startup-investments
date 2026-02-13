---
paths:
  - "infrastructure/**"
---

# Azure Infrastructure Rules (ABSOLUTE - NO EXCEPTIONS)

**All resources ALREADY EXIST.** Never run `az ... create`, `az ... delete`, or modify network/firewall settings. If something seems broken: check logs first, ask before acting, prefer restart over recreate.

**Key resources:**

| Resource | Name | Resource Group |
|----------|------|----------------|
| App Service | `buildatlas-web` | `rg-startup-analysis` |
| AKS | `aks-aistartuptr` | `aistartuptr` |
| PostgreSQL | `aistartupstr` | `aistartupstr` |
| Redis | `aistartupstr-redis-cache` | `aistartupstr` |
| ACR | `aistartuptr` | `aistartuptr` |
| Storage | `buildatlasstorage` | `aistartuptr` |

**VM SSH unreachable?** Azure JIT expires NSG rules. See `docs/claude/vm-cron.md` for the two `az network nsg rule create` commands needed to restore access.

**Bash arithmetic gotcha:** `(( var++ ))` with `set -e` exits on zero — use `var=$((var + 1))` instead.

**VM .env quoting:** Values with semicolons MUST be quoted (`"val1;val2"`) or `source` breaks them.
