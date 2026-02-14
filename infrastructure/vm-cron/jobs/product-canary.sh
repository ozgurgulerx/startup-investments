#!/bin/bash
# product-canary.sh — Product surface canary checks.
#
# Goal: catch regressions in the user-facing "intelligence" surfaces:
# - Dealbook brief snapshot schema (including verticalLandscape + capitalGraph)
# - Landscapes (pattern treemap + cluster detail)
# - Investor DNA screener (warn if empty; don't fail yet)
# - Deep dives (must have at least one ready deep dive)
#
# Slack behavior:
# - Posts only on status transitions (ok<->warn<->fail) OR periodic reminders (every 6h while warn/fail).
# - Always exits 0 to avoid runner.sh failure Slack spam (runner always notifies on non-zero).
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_DIR="$(mktemp -d 2>/dev/null || echo "")"
if [ -z "$TMP_DIR" ] || [ ! -d "$TMP_DIR" ]; then
  TMP_DIR="/tmp/buildatlas-product-canary.$$"
  mkdir -p "$TMP_DIR" 2>/dev/null || true
fi
trap 'rm -rf "$TMP_DIR" 2>/dev/null || true' EXIT

API_BASE_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}"
FRONTEND_URL="${PUBLIC_BASE_URL:-https://buildatlas.net}"

STATE_FILE_PRIMARY="/var/lib/buildatlas/product-canary.state"
STATE_FILE_FALLBACK="$ROOT_DIR/.tmp/product-canary.state"
STATE_FILE_TMP="/tmp/buildatlas-product-canary.state"

choose_state_file() {
  local candidate=""

  candidate="$STATE_FILE_PRIMARY"
  if mkdir -p "$(dirname "$candidate")" 2>/dev/null && touch "$candidate" 2>/dev/null; then
    echo "$candidate"
    return 0
  fi

  candidate="$STATE_FILE_FALLBACK"
  if mkdir -p "$(dirname "$candidate")" 2>/dev/null && touch "$candidate" 2>/dev/null; then
    echo "$candidate"
    return 0
  fi

  # Last resort: /tmp (may not survive reboot).
  candidate="$STATE_FILE_TMP"
  if mkdir -p "$(dirname "$candidate")" 2>/dev/null && touch "$candidate" 2>/dev/null; then
    echo "$candidate"
    return 0
  fi

  # If nothing is writable, fall back to a temp file (no persistence).
  echo "$TMP_DIR/product-canary.state"
}

STATE_FILE="$(choose_state_file)"

NOW_TS="$(date +%s)"
PREV_STATUS=""
LAST_NOTIFIED_AT="0"

if [ -s "$STATE_FILE" ]; then
  STATE_RAW="$(python3 - "$STATE_FILE" <<'PY' 2>/dev/null || true
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    data = {}

status = data.get("status") or ""
notified_at = data.get("notified_at") or 0
try:
    notified_at = int(notified_at)
except Exception:
    notified_at = 0

print(status)
print(notified_at)
PY
)"
  PREV_STATUS="$(printf '%s\n' "$STATE_RAW" | sed -n '1p')"
  LAST_NOTIFIED_AT="$(printf '%s\n' "$STATE_RAW" | sed -n '2p')"
fi

STATUS="ok"
# With `set -u`, empty-but-undeclared arrays can raise "unbound variable" on `${#arr[@]}`.
# Initialize explicitly so output formatting is reliable even when no failures/warnings exist.
FAIL_LINES=()
WARN_LINES=()
INFO_LINES=()

set_status_fail() {
  STATUS="fail"
  FAIL_LINES+=("$1")
}

set_status_warn() {
  if [ "$STATUS" != "fail" ]; then
    STATUS="warn"
  fi
  WARN_LINES+=("$1")
}

add_info() {
  INFO_LINES+=("$1")
}

fetch() {
  local url="$1"
  local out="$2"
  shift 2
  curl -sS --max-time 25 --retry 2 --retry-delay 1 -o "$out" -w "%{http_code}" "$@" "$url" 2>/dev/null || echo "000"
}

urlencode() {
  python3 - "$1" <<'PY' 2>/dev/null
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1] if len(sys.argv) > 1 else ""))
PY
}

echo "=== Product Canary ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "State file: $STATE_FILE"
echo "API base: $API_BASE_URL"
echo "Frontend: $FRONTEND_URL"
echo ""

# ---------------------------------------------------------------------------
# Frontend basic checks (public)
# ---------------------------------------------------------------------------
FE_BRIEF_HTML="$TMP_DIR/brief.html"
FE_INVESTORS_HTML="$TMP_DIR/investors.html"
FE_LANDSCAPES_HTML="$TMP_DIR/landscapes.html"

FE_BRIEF_HTTP="$(fetch "$FRONTEND_URL/brief" "$FE_BRIEF_HTML")"
if [ "$FE_BRIEF_HTTP" != "200" ]; then
  set_status_fail "frontend /brief HTTP $FE_BRIEF_HTTP"
else
  add_info "frontend /brief HTTP 200"
fi

FE_INV_HTTP="$(fetch "$FRONTEND_URL/investors" "$FE_INVESTORS_HTML")"
if [ "$FE_INV_HTTP" != "200" ]; then
  set_status_fail "frontend /investors HTTP $FE_INV_HTTP"
else
  add_info "frontend /investors HTTP 200"
fi

FE_LAND_HTTP="$(fetch "$FRONTEND_URL/landscapes" "$FE_LANDSCAPES_HTML")"
if [ "$FE_LAND_HTTP" != "200" ]; then
  set_status_fail "frontend /landscapes HTTP $FE_LAND_HTTP"
else
  add_info "frontend /landscapes HTTP 200"
fi

# Extract build sha (best effort)
WEB_SHA="$(grep -Eo 'name=\"ba-build-sha\" content=\"[a-f0-9]+\"' "$FE_BRIEF_HTML" 2>/dev/null | head -n 1 | sed -E 's/.*content=\"([a-f0-9]+)\".*/\1/' || true)"
if [ -n "$WEB_SHA" ]; then
  add_info "web sha: $WEB_SHA"
fi

# ---------------------------------------------------------------------------
# API healthz (public)
# ---------------------------------------------------------------------------
API_HEALTH_JSON="$TMP_DIR/api_healthz.json"
API_HEALTH_HTTP="$(fetch "$API_BASE_URL/healthz" "$API_HEALTH_JSON")"
API_SHA=""

if [ "$API_HEALTH_HTTP" != "200" ]; then
  set_status_fail "api /healthz HTTP $API_HEALTH_HTTP"
else
  API_SHA="$(python3 - "$API_HEALTH_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(d.get("build_sha") or "")
except Exception:
    print("")
PY
  )"
  if [ -n "$API_SHA" ]; then
    add_info "api sha: $API_SHA"
  else
    set_status_warn "api /healthz missing build_sha"
  fi
fi

# ---------------------------------------------------------------------------
# Protected endpoints (require API_KEY)
# ---------------------------------------------------------------------------
if [ -z "${API_KEY:-}" ]; then
  set_status_fail "API_KEY missing (cannot query /api/* endpoints)"
else
  # --- Brief edition list ---
  BRIEF_LIST_JSON="$TMP_DIR/brief_list.json"
  BRIEF_LIST_URL="$API_BASE_URL/api/v1/briefs/list?region=global&period_type=monthly&kind=rolling&limit=1&offset=0"
  BRIEF_LIST_HTTP="$(fetch "$BRIEF_LIST_URL" "$BRIEF_LIST_JSON" -H "X-API-Key: ${API_KEY}")"
  if [ "$BRIEF_LIST_HTTP" != "200" ]; then
    set_status_fail "briefs list HTTP $BRIEF_LIST_HTTP"
  else
    BRIEF_EDITION_ID="$(python3 - "$BRIEF_LIST_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
items = d.get("items") or []
if not items or not isinstance(items, list):
    print("")
    raise SystemExit(0)
eid = items[0].get("editionId") if isinstance(items[0], dict) else ""
print(eid or "")
PY
    )"
    BRIEF_TOTAL="$(python3 - "$BRIEF_LIST_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int(d.get("total") or 0))
except Exception:
    print(0)
PY
    )"

    if [ "${BRIEF_TOTAL:-0}" -le 0 ] || [ -z "$BRIEF_EDITION_ID" ]; then
      set_status_fail "briefs list returned 0 items"
    else
      add_info "brief edition: $BRIEF_EDITION_ID"
    fi

    # --- Brief snapshot schema ---
    if [ -n "$BRIEF_EDITION_ID" ]; then
      BRIEF_JSON="$TMP_DIR/brief.json"
      BRIEF_URL="$API_BASE_URL/api/v1/brief?edition_id=$BRIEF_EDITION_ID&region=global&period_type=monthly&kind=rolling"
      BRIEF_HTTP="$(fetch "$BRIEF_URL" "$BRIEF_JSON" -H "X-API-Key: ${API_KEY}")"
      if [ "$BRIEF_HTTP" != "200" ]; then
        set_status_fail "brief HTTP $BRIEF_HTTP"
      else
        BRIEF_REPORT_JSON="$TMP_DIR/brief_report.json"
        python3 - "$BRIEF_JSON" > "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || echo '{"hard_errors":["brief report failed"],"counts":{}}' > "$BRIEF_REPORT_JSON"
import json
import sys

path = sys.argv[1]
try:
    d = json.load(open(path, "r", encoding="utf-8"))
except Exception as e:
    print(json.dumps({"hard_errors": [f"invalid JSON: {e}"], "counts": {}}, ensure_ascii=True))
    raise SystemExit(0)

hard = []

def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)

metrics = d.get("metrics")
if not isinstance(metrics, dict):
    hard.append("metrics is missing")
else:
    tf = metrics.get("totalFunding")
    dc = metrics.get("dealCount")
    if not is_num(tf) or tf < 0:
        hard.append("metrics.totalFunding must be >= 0")
    if not is_num(dc) or dc < 0:
        hard.append("metrics.dealCount must be >= 0")

if not isinstance(d.get("patternLandscape"), list):
    hard.append("patternLandscape is not an array")

vl = d.get("verticalLandscape")
if not isinstance(vl, dict) or not isinstance(vl.get("topVerticals"), list) or not isinstance(vl.get("topSubVerticals"), list):
    hard.append("verticalLandscape is invalid")

cg = d.get("capitalGraph")
if not isinstance(cg, dict) or not isinstance(cg.get("topInvestors"), list) or not isinstance(cg.get("topFounders"), list):
    hard.append("capitalGraph is invalid")

inv = d.get("investors")
if not isinstance(inv, dict) or not isinstance(inv.get("mostActive"), list) or not isinstance(inv.get("megaCheckWriters"), list):
    hard.append("investors is invalid")

if not isinstance(d.get("topDeals"), list):
    hard.append("topDeals is not an array")

status = d.get("status")
if status not in ("draft", "ready", "sealed"):
    hard.append(f"invalid status: {status!r}")

counts = {
    "vertical_top": len(vl.get("topVerticals", [])) if isinstance(vl, dict) else 0,
    "subvertical_top": len(vl.get("topSubVerticals", [])) if isinstance(vl, dict) else 0,
    "capital_available": bool(cg.get("available")) if isinstance(cg, dict) else False,
    "capital_top_investors": len(cg.get("topInvestors", [])) if isinstance(cg, dict) else 0,
    "capital_top_founders": len(cg.get("topFounders", [])) if isinstance(cg, dict) else 0,
    "investors_most_active": len(inv.get("mostActive", [])) if isinstance(inv, dict) else 0,
    "investors_mega_check": len(inv.get("megaCheckWriters", [])) if isinstance(inv, dict) else 0,
    "top_deals": len(d.get("topDeals", [])) if isinstance(d.get("topDeals"), list) else 0,
}

print(json.dumps({"hard_errors": hard, "counts": counts}, ensure_ascii=True))
PY

        HARD_ERROR_COUNT="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(len(d.get("hard_errors") or []))
except Exception:
    print(1)
PY
        )"

        if [ "${HARD_ERROR_COUNT:-1}" -gt 0 ]; then
          HARD_ERRORS="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    errs = d.get("hard_errors") or []
    if not isinstance(errs, list):
        errs = [str(errs)]
    print("; ".join([str(e) for e in errs if str(e).strip()]))
except Exception:
    print("brief schema validation failed")
PY
          )"
          set_status_fail "brief schema: ${HARD_ERRORS:-invalid}"
        else
          add_info "brief schema: ok"

          VERTICAL_TOP="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json,sys
try:
    d=json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int((d.get("counts") or {}).get("vertical_top") or 0))
except Exception:
    print(0)
PY
          )"
          CAPITAL_AVAIL="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json,sys
try:
    d=json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print("true" if bool((d.get("counts") or {}).get("capital_available")) else "false")
except Exception:
    print("false")
PY
          )"
          CAPITAL_TOP_INV="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json,sys
try:
    d=json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int((d.get("counts") or {}).get("capital_top_investors") or 0))
except Exception:
    print(0)
PY
          )"
          INVESTORS_MOST_ACTIVE="$(python3 - "$BRIEF_REPORT_JSON" <<'PY' 2>/dev/null || true
import json,sys
try:
    d=json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int((d.get("counts") or {}).get("investors_most_active") or 0))
except Exception:
    print(0)
PY
          )"

          if [ "${VERTICAL_TOP:-0}" -le 0 ]; then
            set_status_warn "brief verticalLandscape is empty"
          fi
          if [ "${CAPITAL_AVAIL:-false}" != "true" ]; then
            set_status_warn "brief capitalGraph unavailable"
          elif [ "${CAPITAL_TOP_INV:-0}" -le 0 ]; then
            set_status_warn "brief capitalGraph has no topInvestors"
          fi
          if [ "${INVESTORS_MOST_ACTIVE:-0}" -le 0 ]; then
            set_status_warn "brief investors.mostActive is empty"
          fi
        fi
      fi
    fi
  fi

  # --- Landscapes (treemap + cluster detail) ---
  LAND_GLOBAL_JSON="$TMP_DIR/landscapes_global.json"
  LAND_GLOBAL_URL="$API_BASE_URL/api/v1/landscapes?size_by=funding&scope=global"
  LAND_GLOBAL_HTTP="$(fetch "$LAND_GLOBAL_URL" "$LAND_GLOBAL_JSON" -H "X-API-Key: ${API_KEY}")"
  if [ "$LAND_GLOBAL_HTTP" != "200" ]; then
    set_status_fail "landscapes treemap HTTP $LAND_GLOBAL_HTTP (global)"
  else
    LAND_GLOBAL_NODES="$(python3 - "$LAND_GLOBAL_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(len(d) if isinstance(d, list) else 0)
except Exception:
    print(0)
PY
    )"
    add_info "landscapes treemap nodes (global): ${LAND_GLOBAL_NODES:-0}"
    if [ "${LAND_GLOBAL_NODES:-0}" -le 0 ]; then
      set_status_fail "landscapes treemap empty (global)"
    fi

    LAND_GLOBAL_HAS_U="$(python3 - "$LAND_GLOBAL_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("false")
    raise SystemExit(0)
if not isinstance(d, list):
    print("false")
    raise SystemExit(0)
print("true" if any(isinstance(n, dict) and (n.get("name") or "") == "Unclassified" for n in d) else "false")
PY
    )"
    LAND_GLOBAL_SAMPLE="$(python3 - "$LAND_GLOBAL_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
if not isinstance(d, list):
    print("")
    raise SystemExit(0)
out = ""
for n in d:
    if not isinstance(n, dict):
        continue
    name = (n.get("name") or "").strip()
    if name and name.lower() != "unclassified":
        out = name
        break
print(out)
PY
    )"

    if [ "${LAND_GLOBAL_HAS_U:-false}" = "true" ]; then
      LAND_U_JSON="$TMP_DIR/landscapes_cluster_global_unclassified.json"
      LAND_U_URL="$API_BASE_URL/api/v1/landscapes/cluster?pattern=Unclassified&scope=global"
      LAND_U_HTTP="$(fetch "$LAND_U_URL" "$LAND_U_JSON" -H "X-API-Key: ${API_KEY}")"
      if [ "$LAND_U_HTTP" != "200" ]; then
        set_status_fail "landscapes cluster HTTP $LAND_U_HTTP (global, Unclassified)"
      else
        LAND_U_COUNT="$(python3 - "$LAND_U_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print(0)
    raise SystemExit(0)
try:
    print(int((d.get("startup_count") if isinstance(d, dict) else 0) or 0))
except Exception:
    print(0)
PY
        )"
        add_info "landscapes cluster startups (global, Unclassified): ${LAND_U_COUNT:-0}"
        if [ "${LAND_U_COUNT:-0}" -le 0 ]; then
          set_status_fail "landscapes cluster has 0 startups (global, Unclassified)"
        fi
      fi
    fi

    if [ -n "${LAND_GLOBAL_SAMPLE:-}" ]; then
      LAND_P_ESC="$(urlencode "$LAND_GLOBAL_SAMPLE")"
      LAND_P_JSON="$TMP_DIR/landscapes_cluster_global_sample.json"
      LAND_P_URL="$API_BASE_URL/api/v1/landscapes/cluster?pattern=${LAND_P_ESC}&scope=global"
      LAND_P_HTTP="$(fetch "$LAND_P_URL" "$LAND_P_JSON" -H "X-API-Key: ${API_KEY}")"
      if [ "$LAND_P_HTTP" != "200" ]; then
        set_status_fail "landscapes cluster HTTP $LAND_P_HTTP (global, ${LAND_GLOBAL_SAMPLE})"
      else
        LAND_P_COUNT="$(python3 - "$LAND_P_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print(0)
    raise SystemExit(0)
try:
    print(int((d.get("startup_count") if isinstance(d, dict) else 0) or 0))
except Exception:
    print(0)
PY
        )"
        add_info "landscapes cluster startups (global, ${LAND_GLOBAL_SAMPLE}): ${LAND_P_COUNT:-0}"
        if [ "${LAND_P_COUNT:-0}" -le 0 ]; then
          set_status_fail "landscapes cluster has 0 startups (global, ${LAND_GLOBAL_SAMPLE})"
        fi
      fi
    else
      set_status_warn "landscapes treemap has no non-Unclassified pattern (global)"
    fi
  fi

  LAND_TR_JSON="$TMP_DIR/landscapes_turkey.json"
  LAND_TR_URL="$API_BASE_URL/api/v1/landscapes?size_by=funding&scope=turkey"
  LAND_TR_HTTP="$(fetch "$LAND_TR_URL" "$LAND_TR_JSON" -H "X-API-Key: ${API_KEY}")"
  if [ "$LAND_TR_HTTP" != "200" ]; then
    if [ "$LAND_TR_HTTP" = "000" ]; then
      set_status_fail "landscapes treemap HTTP 000 (turkey)"
    else
      set_status_warn "landscapes treemap HTTP $LAND_TR_HTTP (turkey)"
    fi
  else
    LAND_TR_NODES="$(python3 - "$LAND_TR_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(len(d) if isinstance(d, list) else 0)
except Exception:
    print(0)
PY
    )"
    add_info "landscapes treemap nodes (turkey): ${LAND_TR_NODES:-0}"
    if [ "${LAND_TR_NODES:-0}" -le 0 ]; then
      set_status_warn "landscapes treemap empty (turkey)"
    fi

    LAND_TR_HAS_U="$(python3 - "$LAND_TR_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("false")
    raise SystemExit(0)
if not isinstance(d, list):
    print("false")
    raise SystemExit(0)
print("true" if any(isinstance(n, dict) and (n.get("name") or "") == "Unclassified" for n in d) else "false")
PY
    )"
    LAND_TR_SAMPLE="$(python3 - "$LAND_TR_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
if not isinstance(d, list):
    print("")
    raise SystemExit(0)
out = ""
for n in d:
    if not isinstance(n, dict):
        continue
    name = (n.get("name") or "").strip()
    if name and name.lower() != "unclassified":
        out = name
        break
if not out:
    # Fall back to Unclassified if it's the only thing available
    for n in d:
        if isinstance(n, dict) and (n.get("name") or "") == "Unclassified":
            out = "Unclassified"
            break
print(out)
PY
    )"

    if [ -n "${LAND_TR_SAMPLE:-}" ]; then
      LAND_TR_P_ESC="$(urlencode "$LAND_TR_SAMPLE")"
      LAND_TR_P_JSON="$TMP_DIR/landscapes_cluster_turkey_sample.json"
      LAND_TR_P_URL="$API_BASE_URL/api/v1/landscapes/cluster?pattern=${LAND_TR_P_ESC}&scope=turkey"
      LAND_TR_P_HTTP="$(fetch "$LAND_TR_P_URL" "$LAND_TR_P_JSON" -H "X-API-Key: ${API_KEY}")"
      if [ "$LAND_TR_P_HTTP" != "200" ]; then
        if [ "$LAND_TR_P_HTTP" = "000" ]; then
          set_status_fail "landscapes cluster HTTP 000 (turkey, ${LAND_TR_SAMPLE})"
        else
          set_status_warn "landscapes cluster HTTP $LAND_TR_P_HTTP (turkey, ${LAND_TR_SAMPLE})"
        fi
      else
        LAND_TR_P_COUNT="$(python3 - "$LAND_TR_P_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print(0)
    raise SystemExit(0)
try:
    print(int((d.get("startup_count") if isinstance(d, dict) else 0) or 0))
except Exception:
    print(0)
PY
        )"
        add_info "landscapes cluster startups (turkey, ${LAND_TR_SAMPLE}): ${LAND_TR_P_COUNT:-0}"
        if [ "${LAND_TR_P_COUNT:-0}" -le 0 ]; then
          set_status_warn "landscapes cluster has 0 startups (turkey, ${LAND_TR_SAMPLE})"
        fi
      fi
    else
      set_status_warn "landscapes treemap has no patterns to sample (turkey)"
    fi
  fi

  # --- Investor DNA screener ---
  INV_SCREENER_JSON="$TMP_DIR/investor_screener.json"
  INV_SCREENER_URL="$API_BASE_URL/api/v1/investors/screener?scope=global&min_deals=1&sort=deal_count&limit=25&offset=0"
  INV_SCREENER_HTTP="$(fetch "$INV_SCREENER_URL" "$INV_SCREENER_JSON" -H "X-API-Key: ${API_KEY}")"
  if [ "$INV_SCREENER_HTTP" != "200" ]; then
    set_status_fail "investor screener HTTP $INV_SCREENER_HTTP"
  else
    INV_TOTAL="$(python3 - "$INV_SCREENER_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int(d.get("total") or 0))
except Exception:
    print(0)
PY
    )"
    add_info "investor dna screener total: ${INV_TOTAL:-0}"
    if [ "${INV_TOTAL:-0}" -le 0 ]; then
      set_status_warn "investor DNA screener is empty (total=0)"
    fi

    INV_SAMPLE_ID="$(python3 - "$INV_SCREENER_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
items = d.get("investors") if isinstance(d, dict) else None
if not isinstance(items, list) or not items:
    print("")
    raise SystemExit(0)
row = items[0]
print((row.get("investor_id") if isinstance(row, dict) else "") or "")
PY
    )"
    if [ -n "${INV_SAMPLE_ID:-}" ]; then
      INV_NEWS_JSON="$TMP_DIR/investor_news.json"
      INV_NEWS_URL="$API_BASE_URL/api/v1/investors/${INV_SAMPLE_ID}/news?scope=global&days=30&limit=5&offset=0"
      INV_NEWS_HTTP="$(fetch "$INV_NEWS_URL" "$INV_NEWS_JSON" -H "X-API-Key: ${API_KEY}")"
      if [ "$INV_NEWS_HTTP" != "200" ]; then
        set_status_fail "investor news HTTP $INV_NEWS_HTTP"
      else
        INV_NEWS_TOTAL="$(python3 - "$INV_NEWS_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(int(d.get("total") or 0))
except Exception:
    print(0)
PY
        )"
        add_info "investor funding news sample (30d): ${INV_NEWS_TOTAL:-0}"
        if [ "${INV_NEWS_TOTAL:-0}" -le 0 ]; then
          set_status_warn "investor news is empty for sample investor (30d total=0)"
        fi
      fi
    else
      set_status_warn "investor screener returned no investor_id sample"
    fi
  fi

  # --- Deep dives ---
  DEEP_DIVES_JSON="$TMP_DIR/deep_dives.json"
  DEEP_DIVES_URL="$API_BASE_URL/api/v1/deep-dives?region=global&limit=5"
  DEEP_DIVES_HTTP="$(fetch "$DEEP_DIVES_URL" "$DEEP_DIVES_JSON" -H "X-API-Key: ${API_KEY}")"
  if [ "$DEEP_DIVES_HTTP" != "200" ]; then
    set_status_fail "deep-dives list HTTP $DEEP_DIVES_HTTP"
  else
    READY_COUNT="$(python3 - "$DEEP_DIVES_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    print(len(d) if isinstance(d, list) else 0)
except Exception:
    print(0)
PY
    )"
    add_info "deep dives ready: ${READY_COUNT:-0}"
    if [ "${READY_COUNT:-0}" -le 0 ]; then
      set_status_fail "no ready deep dives found"
    else
      SIGNAL_ID="$(python3 - "$DEEP_DIVES_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
if not isinstance(d, list) or not d:
    print("")
    raise SystemExit(0)
row = d[0]
print((row.get("signal_id") if isinstance(row, dict) else "") or "")
PY
      )"
      if [ -n "$SIGNAL_ID" ]; then
        DEEP_DIVE_DETAIL_JSON="$TMP_DIR/deep_dive_detail.json"
        DEEP_DIVE_DETAIL_URL="$API_BASE_URL/api/v1/signals/$SIGNAL_ID/deep-dive"
        DEEP_DIVE_DETAIL_HTTP="$(fetch "$DEEP_DIVE_DETAIL_URL" "$DEEP_DIVE_DETAIL_JSON" -H "X-API-Key: ${API_KEY}")"
        if [ "$DEEP_DIVE_DETAIL_HTTP" != "200" ]; then
          set_status_fail "signal deep-dive HTTP $DEEP_DIVE_DETAIL_HTTP"
        else
          DD_STATUS="$(python3 - "$DEEP_DIVE_DETAIL_JSON" <<'PY' 2>/dev/null || true
import json
import sys
try:
    d = json.load(open(sys.argv[1], "r", encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
dd = d.get("deep_dive") if isinstance(d, dict) else None
print((dd or {}).get("status") if isinstance(dd, dict) else "")
PY
          )"
          if [ "$DD_STATUS" != "ready" ]; then
            set_status_fail "signal deep-dive not ready (status=${DD_STATUS:-missing})"
          else
            add_info "signal deep-dive: ready ($SIGNAL_ID)"
          fi
        fi
      else
        set_status_fail "deep-dives list returned no signal_id"
      fi
    fi
  fi
fi

should_notify=false
if [ -z "$PREV_STATUS" ] || [ "$PREV_STATUS" != "$STATUS" ]; then
  should_notify=true
elif [ "$STATUS" != "ok" ] && [ $((NOW_TS - LAST_NOTIFIED_AT)) -ge 21600 ]; then
  should_notify=true
fi

slack_status="info"
slack_title="Product Canary"

case "$STATUS" in
  ok)
    slack_status="success"
    if [ "$PREV_STATUS" = "warn" ] || [ "$PREV_STATUS" = "fail" ]; then
      slack_title="Product Canary: OK (recovered)"
    else
      slack_title="Product Canary: OK"
    fi
    ;;
  warn)
    slack_status="warning"
    slack_title="Product Canary: WARN"
    ;;
  fail)
    slack_status="failure"
    slack_title="Product Canary: FAIL"
    ;;
esac

build_body() {
  local out=""
  if [ "${#FAIL_LINES[@]}" -gt 0 ]; then
    out="${out}*Failures:*\n"
    for line in "${FAIL_LINES[@]}"; do
      out="${out}- ${line}\n"
    done
    out="${out}\n"
  fi
  if [ "${#WARN_LINES[@]}" -gt 0 ]; then
    out="${out}*Warnings:*\n"
    for line in "${WARN_LINES[@]}"; do
      out="${out}- ${line}\n"
    done
    out="${out}\n"
  fi
  if [ "${#INFO_LINES[@]}" -gt 0 ]; then
    out="${out}*Notes:*\n"
    for line in "${INFO_LINES[@]}"; do
      out="${out}- ${line}\n"
    done
  fi
  printf "%b" "$out"
}

slack_body="$(build_body)"

echo "Status: $STATUS (prev: ${PREV_STATUS:-<none>})"
if [ "${#FAIL_LINES[@]}" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for line in "${FAIL_LINES[@]}"; do echo "- $line"; done
fi
if [ "${#WARN_LINES[@]}" -gt 0 ]; then
  echo ""
  echo "Warnings:"
  for line in "${WARN_LINES[@]}"; do echo "- $line"; done
fi
if [ "${#INFO_LINES[@]}" -gt 0 ]; then
  echo ""
  echo "Notes:"
  for line in "${INFO_LINES[@]}"; do echo "- $line"; done
fi
echo ""

notified=false
if [ "$should_notify" = true ]; then
  SLACK_TITLE="$slack_title" \
  SLACK_STATUS="$slack_status" \
  SLACK_BODY="$slack_body" \
  SLACK_URL="$FRONTEND_URL/brief" \
  python3 "$ROOT_DIR/scripts/slack_notify.py" >/dev/null 2>&1 && notified=true
fi

# Persist state (best effort).
python3 - "$STATE_FILE" <<PY 2>/dev/null || true
import json
import os
import sys
import time

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}

data["status"] = "${STATUS}"
data["last_run_at"] = int(time.time())
if "${notified}" == "true":
    data["notified_at"] = int(time.time())

tmp = f"{path}.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=True, sort_keys=True)
os.replace(tmp, path)
PY

exit 0
