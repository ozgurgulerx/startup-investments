// Azure Front Door Standard for API protection
// Deploy with: az deployment group create -g aistartuptr -f frontdoor.bicep --parameters apiHostname=172.211.176.100

@description('Location for all resources')
param location string = resourceGroup().location

@description('The hostname or IP of the API backend')
param apiHostname string

@description('Environment name')
param environment string = 'prod'

var baseName = 'aistartuptr'
var uniqueSuffix = uniqueString(resourceGroup().id)

// Azure Front Door Standard for API protection
resource frontDoor 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: 'afd-${baseName}-${uniqueSuffix}'
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
    hostName: apiHostname
    httpPort: 80
    httpsPort: 443
    originHostHeader: apiHostname
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

// Outputs
output frontDoorEndpoint string = frontDoorEndpoint.properties.hostName
output frontDoorId string = frontDoor.properties.frontDoorId
