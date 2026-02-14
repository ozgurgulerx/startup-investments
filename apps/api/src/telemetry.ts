// Application Insights telemetry initialization.
// MUST be imported at the very top of index.ts, before Express/pg/redis.
// The SDK hooks into Node.js module loading to auto-instrument dependencies.
//
// Wrapped in try-catch: telemetry must NEVER crash the API.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _telemetryClient: any = null;

try {
  // Use require() for reliable CJS interop with applicationinsights v2/v3.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const appInsights = require('applicationinsights');

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

  if (connectionString && typeof appInsights.setup === 'function') {
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
    _telemetryClient = client;

    console.log('Application Insights initialized (sampling: 50%)');
  } else if (!connectionString) {
    console.log('Application Insights: APPLICATIONINSIGHTS_CONNECTION_STRING not set, telemetry disabled');
  } else {
    console.log('Application Insights: setup() not available (check package version), telemetry disabled');
  }
} catch (err) {
  console.log(`Application Insights init failed: ${err instanceof Error ? err.message : err}`);
}

export const telemetryClient = _telemetryClient;
