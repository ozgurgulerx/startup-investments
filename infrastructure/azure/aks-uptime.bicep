// AKS uptime guardrails (Azure Automation).
//
// Intent:
// - Keep the AKS cluster from staying in a Stopped state by running a guard runbook on a schedule.
// - Avoid reliance on GitHub Actions schedules or the VM cron runner for uptime enforcement.
//
// Deploy (example):
//   az deployment group create -g aistartuptr -f infrastructure/azure/aks-uptime.bicep \
//     --parameters slackWebhookUrl="https://hooks.slack.com/services/..." scheduleIntervalMinutes=15

@description('Location for resources (Automation Account).')
param location string = resourceGroup().location

// This template assumes the AKS cluster lives in the same resource group as this deployment.
var aksResourceGroupName = resourceGroup().name

@description('AKS cluster name.')
param aksClusterName string = 'aks-aistartuptr'

@description('Automation account name.')
param automationAccountName string = 'aa-buildatlas-aks-uptime'

@description('Runbook name.')
param runbookName string = 'buildatlas-aks-ensure-running'

@description('API base URL used for a lightweight health check (runbook calls API_URL + "/health").')
param apiUrl string = 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net'

@secure()
@description('Slack webhook URL for notifications (stored as an encrypted Automation variable).')
param slackWebhookUrl string = ''

@allowed([
  5
  10
  15
  20
  30
  60
])
@description('How often to run the guard runbook (minutes).')
param scheduleIntervalMinutes int = 15

@description('Schedule start time (ISO 8601). Default: now+10m (Azure Automation may require >= 5m).')
param scheduleStartTime string = dateTimeAdd(utcNow(), 'PT10M')

var contributorRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')

resource automation 'Microsoft.Automation/automationAccounts@2023-11-01' = {
  name: automationAccountName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    sku: {
      name: 'Basic'
    }
  }
  tags: {
    app: 'buildatlas'
    purpose: 'aks-uptime'
  }
}

resource aks 'Microsoft.ContainerService/managedClusters@2023-10-01' existing = {
  name: aksClusterName
}

// Required for the runbook's managed identity to be able to start the cluster.
resource automationToAksContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // RoleAssignment name must be known at deployment start; avoid using principalId (assigned after creation).
  name: guid(aks.id, automation.id, 'automation-aks-contributor')
  scope: aks
  properties: {
    roleDefinitionId: contributorRoleDefinitionId
    principalId: automation.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Runbook configuration is passed via Automation variables to avoid hardcoding values in the script.
resource varAksRg 'Microsoft.Automation/automationAccounts/variables@2023-11-01' = {
  parent: automation
  name: 'AKS_RESOURCE_GROUP'
  properties: {
    isEncrypted: false
    value: aksResourceGroupName
  }
}

resource varAksName 'Microsoft.Automation/automationAccounts/variables@2023-11-01' = {
  parent: automation
  name: 'AKS_CLUSTER_NAME'
  properties: {
    isEncrypted: false
    value: aksClusterName
  }
}

resource varApiUrl 'Microsoft.Automation/automationAccounts/variables@2023-11-01' = {
  parent: automation
  name: 'API_URL'
  properties: {
    isEncrypted: false
    value: apiUrl
  }
}

resource varSlack 'Microsoft.Automation/automationAccounts/variables@2023-11-01' = {
  parent: automation
  name: 'SLACK_WEBHOOK_URL'
  properties: {
    isEncrypted: true
    value: slackWebhookUrl
  }
}

resource runbook 'Microsoft.Automation/automationAccounts/runbooks@2023-11-01' = {
  parent: automation
  name: runbookName
  location: location
  properties: {
    runbookType: 'PowerShell'
    logProgress: true
    logVerbose: true
    description: 'Ensures the AKS cluster reports Running; starts it if Stopped; posts Slack notifications.'
  }
}

resource schedule 'Microsoft.Automation/automationAccounts/schedules@2023-11-01' = {
  parent: automation
  name: '${runbookName}-every-${scheduleIntervalMinutes}m'
  properties: {
    // Frequency supports Minute/Hour/Day/Week/Month/OneTime.
    frequency: 'Minute'
    interval: scheduleIntervalMinutes
    startTime: scheduleStartTime
    timeZone: 'UTC'
    description: 'AKS uptime guard schedule (UTC).'
  }
}

// jobSchedules requires a GUID name; keep it deterministic so redeploys are idempotent.
resource jobSchedule 'Microsoft.Automation/automationAccounts/jobSchedules@2023-11-01' = {
  parent: automation
  name: guid(automation.id, schedule.name, runbook.name)
  properties: {
    schedule: {
      name: schedule.name
    }
    runbook: {
      name: runbook.name
    }
    parameters: {}
  }
}

output automationAccountId string = automation.id
output automationAccountName string = automation.name
output automationPrincipalId string = automation.identity.principalId
output runbookResourceId string = runbook.id
output scheduleName string = schedule.name
output aksId string = aks.id
