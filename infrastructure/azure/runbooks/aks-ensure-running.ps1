<#
AKS ensure-running guard (Azure Automation Runbook)

Behavior:
- Reads config from Automation variables:
  - AKS_RESOURCE_GROUP
  - AKS_CLUSTER_NAME
  - API_URL (optional; used for /health check)
  - SLACK_WEBHOOK_URL (encrypted; optional)
- Uses the Automation Account managed identity to:
  - Check AKS powerState
  - Start AKS when Stopped
- Posts Slack only on:
  - state change (Stopped -> start triggered), or
  - failures / unhealthy outcomes

Notes:
- This runbook intentionally keeps logic lightweight and relies on ARM REST calls
  via Invoke-AzRestMethod for compatibility across Az module versions.
#>

param(
  [object]$WebhookData,
  [string]$AksResourceGroup = "",
  [string]$AksClusterName = "",
  [string]$ApiUrl = "",
  [int]$MaxWaitMinutes = 20,
  [int]$PollSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function _Get-AutomationVar([string]$Name, [string]$Default = "") {
  try {
    $v = Get-AutomationVariable -Name $Name
    if ($null -eq $v -or ($v -is [string] -and $v.Trim() -eq "")) {
      return $Default
    }
    return [string]$v
  } catch {
    return $Default
  }
}

function _Send-Slack([string]$Title, [string]$Status, [string]$Body) {
  $slackUrl = _Get-AutomationVar -Name "SLACK_WEBHOOK_URL" -Default ""
  if (-not $slackUrl) {
    Write-Output "SLACK_WEBHOOK_URL missing; skipping Slack notify."
    return
  }

  $payload = @{
    text = "*$Title*`nStatus: $Status`n$Body"
  } | ConvertTo-Json -Depth 6

  try {
    Invoke-RestMethod -Method Post -Uri $slackUrl -Body $payload -ContentType "application/json" | Out-Null
  } catch {
    Write-Output "Slack notify failed: $($_.Exception.Message)"
  }
}

function _Try-Get-ApiHealth([string]$BaseUrl) {
  if (-not $BaseUrl) { return @{ ok = $false; status = ""; error = "API_URL missing" } }
  $u = $BaseUrl.TrimEnd("/") + "/health"
  try {
    $resp = Invoke-WebRequest -Uri $u -Method GET -TimeoutSec 20 -UseBasicParsing
    return @{ ok = ($resp.StatusCode -eq 200); status = [string]$resp.StatusCode; error = "" }
  } catch {
    return @{ ok = $false; status = ""; error = $_.Exception.Message }
  }
}

function _Get-AksPowerState([string]$AksResourceId, [string]$ApiVersion) {
  $resp = Invoke-AzRestMethod -Method GET -Path ($AksResourceId + "?api-version=" + $ApiVersion)
  $obj = $resp.Content | ConvertFrom-Json -Depth 50
  $code = $null
  try { $code = $obj.properties.powerState.code } catch { $code = $null }
  if (-not $code) { $code = "UNKNOWN" }
  return [string]$code
}

function _Start-Aks([string]$AksResourceId, [string]$ApiVersion) {
  Invoke-AzRestMethod -Method POST -Path ($AksResourceId + "/start?api-version=" + $ApiVersion) | Out-Null
}

try {
  if (-not $AksResourceGroup) { $AksResourceGroup = _Get-AutomationVar -Name "AKS_RESOURCE_GROUP" -Default "" }
  if (-not $AksClusterName) { $AksClusterName = _Get-AutomationVar -Name "AKS_CLUSTER_NAME" -Default "" }
  if (-not $ApiUrl) { $ApiUrl = _Get-AutomationVar -Name "API_URL" -Default "" }

  if (-not $AksResourceGroup -or -not $AksClusterName) {
    throw "Missing AKS_RESOURCE_GROUP or AKS_CLUSTER_NAME (params or Automation variables)."
  }

  Disable-AzContextAutosave -Scope Process | Out-Null
  Connect-AzAccount -Identity | Out-Null

  $ctx = Get-AzContext
  if ($null -eq $ctx -or $null -eq $ctx.Subscription -or -not $ctx.Subscription.Id) {
    throw "Unable to determine subscription from Az context."
  }

  # Keep api-version stable; align with infra bicep AKS api-version.
  $apiVersion = "2023-10-01"
  $subId = $ctx.Subscription.Id
  $aksId = "/subscriptions/$subId/resourceGroups/$AksResourceGroup/providers/Microsoft.ContainerService/managedClusters/$AksClusterName"

  $initial = _Get-AksPowerState -AksResourceId $aksId -ApiVersion $apiVersion
  Write-Output "AKS powerState: $initial"

  $actionTaken = "none"
  $final = $initial

  if ($initial -eq "Stopped") {
    $actionTaken = "start"
    Write-Output "AKS is Stopped; triggering start..."
    _Start-Aks -AksResourceId $aksId -ApiVersion $apiVersion

    $deadline = (Get-Date).ToUniversalTime().AddMinutes($MaxWaitMinutes)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      Start-Sleep -Seconds $PollSeconds
      $final = _Get-AksPowerState -AksResourceId $aksId -ApiVersion $apiVersion
      Write-Output "Waiting for AKS to be Running... state=$final"
      if ($final -eq "Running") { break }
    }

    if ($final -ne "Running") {
      throw "AKS did not reach Running within ${MaxWaitMinutes}m (final=$final)."
    }
  } elseif ($initial -ne "Running") {
    # Non-Running states can happen transiently; alert (no mutation) so humans have traceability.
    $actionTaken = "observe"
  }

  $health = _Try-Get-ApiHealth -BaseUrl $ApiUrl
  $healthLine = if ($health.ok) { "api=healthy status=$($health.status)" } else { "api=unhealthy error=$($health.error)" }

  $detail = @(
    "cluster=$AksClusterName",
    "rg=$AksResourceGroup",
    "initial=$initial",
    "final=$final",
    "action=$actionTaken",
    $healthLine,
    "ts_utc=$(Get-Date -Format o)"
  ) -join " | "

  Write-Output $detail

  # Slack notify: only on change or unhealthy outcome.
  if ($actionTaken -eq "start") {
    _Send-Slack -Title "AKS was stopped; start triggered" -Status "info" -Body $detail
  } elseif (-not $health.ok -or $final -ne "Running") {
    _Send-Slack -Title "AKS uptime guard detected an unhealthy state" -Status "warning" -Body $detail
  } else {
    Write-Output "No-op; skipping Slack notify."
  }
} catch {
  $msg = $_.Exception.Message
  Write-Output "Runbook failure: $msg"
  try {
    _Send-Slack -Title "AKS uptime guard failed" -Status "failure" -Body "error=$msg | ts_utc=$(Get-Date -Format o)"
  } catch {
    # Best-effort only.
  }
  throw
}

