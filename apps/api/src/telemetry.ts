// Application Insights telemetry initialization.
// MUST be imported at the very top of index.ts, before Express/pg/redis.
// The SDK hooks into Node.js module loading to auto-instrument dependencies.

import appInsights from 'applicationinsights';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  appInsights.setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .setSendLiveMetrics(false)
    .start();

  const client = appInsights.defaultClient;
  client.context.tags[client.context.keys.cloudRole] = 'startup-investments-api';
  client.config.samplingPercentage = 50;

  console.log('Application Insights initialized (sampling: 50%)');
} else {
  console.log('Application Insights: APPLICATIONINSIGHTS_CONNECTION_STRING not set, telemetry disabled');
}

export const telemetryClient = connectionString ? appInsights.defaultClient : null;
