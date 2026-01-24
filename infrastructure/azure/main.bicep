// Azure Infrastructure for Startup Investments Platform
// Deploys: AKS, PostgreSQL Flexible Server, Container Registry, Static Web App

@description('Location for all resources')
param location string = resourceGroup().location

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Base name for resources')
param baseName string = 'startupinv'

var resourceSuffix = '${baseName}-${environment}'

// Container Registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${baseName}acr${environment}'
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// AKS Cluster
resource aks 'Microsoft.ContainerService/managedClusters@2023-10-01' = {
  name: 'aks-${resourceSuffix}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: 'aks-${resourceSuffix}'
    agentPoolProfiles: [
      {
        name: 'default'
        count: 2
        vmSize: 'Standard_B2s'
        mode: 'System'
        osType: 'Linux'
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
    }
  }
}

// PostgreSQL Flexible Server
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: 'psql-${resourceSuffix}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '15'
    administratorLogin: 'pgadmin'
    administratorLoginPassword: 'CHANGE_ME_IN_KEYVAULT' // Use Key Vault in production
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// PostgreSQL Database
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgres
  name: 'startupinvestments'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Static Web App for Frontend
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: 'swa-${resourceSuffix}'
  location: 'westus2' // Static Web Apps have limited regions
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

// Outputs
output acrLoginServer string = acr.properties.loginServer
output aksName string = aks.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output staticWebAppUrl string = staticWebApp.properties.defaultHostname
