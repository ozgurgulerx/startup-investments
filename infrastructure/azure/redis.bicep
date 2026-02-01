// Azure Cache for Redis
// Provides caching layer for API to reduce database load

@description('Location for Redis')
param location string = resourceGroup().location

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'prod'

@description('Base name for resources')
param baseName string = 'buildatlas'

var redisCacheName = 'redis-${baseName}-${environment}'

// Azure Cache for Redis - Basic C0 tier
// 250MB cache, sufficient for API response caching
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisCacheName
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0  // C0 = 250MB, ~$16/month
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'  // Can restrict later with VNet
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
output redisHostName string = redisCache.properties.hostName
output redisPort int = redisCache.properties.sslPort
output redisName string = redisCache.name

// Connection string format for node-redis:
// rediss://:PASSWORD@HOSTNAME:PORT
// Note: Use 'rediss://' (with double s) for SSL connections
@description('Redis connection string (requires listKeys to get password)')
output redisConnectionStringTemplate string = 'rediss://:PASSWORD@${redisCache.properties.hostName}:${redisCache.properties.sslPort}'
