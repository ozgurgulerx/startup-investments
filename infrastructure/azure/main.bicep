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

// Public IP for AKS Load Balancer (stable IP for Front Door origin)
resource aksPublicIp 'Microsoft.Network/publicIPAddresses@2023-05-01' = {
  name: 'pip-aks-${resourceSuffix}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: 'api-${resourceSuffix}'
    }
  }
}

// Azure Front Door Standard for API protection
resource frontDoor 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: 'afd-${resourceSuffix}'
  location: 'global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

// Front Door Endpoint
resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: frontDoor
  name: 'api-endpoint'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

// Front Door Origin Group
resource frontDoorOriginGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: frontDoor
  name: 'api-origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'GET'
      probeProtocol: 'Http'
      probeIntervalInSeconds: 30
    }
    sessionAffinityState: 'Disabled'
  }
}

// Front Door Origin (points to AKS Load Balancer)
resource frontDoorOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: frontDoorOriginGroup
  name: 'aks-origin'
  properties: {
    hostName: aksPublicIp.properties.dnsSettings.fqdn
    httpPort: 80
    httpsPort: 443
    originHostHeader: aksPublicIp.properties.dnsSettings.fqdn
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

// Front Door Route
resource frontDoorRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: frontDoorEndpoint
  name: 'api-route'
  properties: {
    originGroup: {
      id: frontDoorOriginGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
  dependsOn: [
    frontDoorOrigin
  ]
}

// Azure Cache for Redis - API response caching
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: 'redis-${resourceSuffix}'
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0  // C0 = 250MB, ~$16/month
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'maxmemory-policy': 'volatile-lru'  // Evict keys with TTL when memory full
    }
  }
  tags: {
    environment: environment
    purpose: 'api-caching'
  }
}

// Outputs
output acrLoginServer string = acr.properties.loginServer
output aksName string = aks.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output staticWebAppUrl string = staticWebApp.properties.defaultHostname
output aksPublicIp string = aksPublicIp.properties.ipAddress
output aksPublicIpResourceId string = aksPublicIp.id
output frontDoorEndpoint string = frontDoorEndpoint.properties.hostName
output frontDoorId string = frontDoor.properties.frontDoorId
output redisHostName string = redisCache.properties.hostName
output redisPort int = redisCache.properties.sslPort
