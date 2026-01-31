/**
 * Backend Health Check and Wake-up Utilities
 *
 * Provides functions to check if the backend API is available
 * and wake up stopped Azure services if needed.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL || 'https://buildatlas-functions.azurewebsites.net';

interface ServiceStatus {
  service: string;
  name: string;
  status: string;
  running: boolean;
  error?: string;
}

interface HealthCheckResponse {
  healthy: boolean;
  services: ServiceStatus[];
  message: string;
}

interface WakeUpResponse {
  actions: Array<{
    service: string;
    action: string;
    message: string;
  }>;
  started: boolean;
  message: string;
}

/**
 * Check if the API is responding
 */
export async function checkApiHealth(): Promise<{
  available: boolean;
  database: boolean;
  latencyMs: number;
}> {
  const start = Date.now();

  try {
    const response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return { available: false, database: false, latencyMs };
    }

    const data = await response.json();

    return {
      available: true,
      database: data.database === 'connected',
      latencyMs,
    };
  } catch (error) {
    return {
      available: false,
      database: false,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check infrastructure status via Azure Functions
 */
export async function checkInfrastructureHealth(): Promise<HealthCheckResponse | null> {
  try {
    const response = await fetch(`${FUNCTIONS_URL}/api/health-check`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      console.error('Infrastructure health check failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Infrastructure health check error:', error);
    return null;
  }
}

/**
 * Wake up stopped Azure services
 */
export async function wakeUpBackend(): Promise<WakeUpResponse | null> {
  try {
    const response = await fetch(`${FUNCTIONS_URL}/api/wake-up`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000), // 30 second timeout for starting services
    });

    if (!response.ok) {
      console.error('Wake up request failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Wake up error:', error);
    return null;
  }
}

/**
 * Smart health check with auto-wake
 *
 * 1. First checks API directly
 * 2. If API is down, checks infrastructure status
 * 3. If infrastructure is stopped, triggers wake-up
 *
 * Returns status and whether wake-up was triggered
 */
export async function ensureBackendAvailable(): Promise<{
  available: boolean;
  wakeUpTriggered: boolean;
  message: string;
  estimatedWaitSeconds?: number;
}> {
  // First, quick check of API
  const apiHealth = await checkApiHealth();

  if (apiHealth.available && apiHealth.database) {
    return {
      available: true,
      wakeUpTriggered: false,
      message: 'Backend is healthy',
    };
  }

  // API not responding, check infrastructure
  const infraHealth = await checkInfrastructureHealth();

  if (!infraHealth) {
    return {
      available: false,
      wakeUpTriggered: false,
      message: 'Unable to check infrastructure status',
    };
  }

  // Check if any services are stopped
  const stoppedServices = infraHealth.services.filter(s => !s.running);

  if (stoppedServices.length === 0) {
    // Services running but API not responding - might be starting up
    return {
      available: false,
      wakeUpTriggered: false,
      message: 'Services are running but API is not responding. It may be starting up.',
      estimatedWaitSeconds: 60,
    };
  }

  // Services are stopped - trigger wake up
  const wakeUpResult = await wakeUpBackend();

  if (wakeUpResult?.started) {
    return {
      available: false,
      wakeUpTriggered: true,
      message: `Starting ${stoppedServices.map(s => s.service).join(' and ')}. Please wait 2-5 minutes.`,
      estimatedWaitSeconds: 180,
    };
  }

  return {
    available: false,
    wakeUpTriggered: false,
    message: wakeUpResult?.message || 'Unable to wake up backend services',
  };
}

/**
 * Poll for backend availability with exponential backoff
 */
export async function waitForBackend(
  maxWaitMs: number = 300000, // 5 minutes default
  onProgress?: (message: string, elapsedMs: number) => void
): Promise<boolean> {
  const startTime = Date.now();
  let waitTime = 5000; // Start with 5 seconds
  const maxInterval = 30000; // Max 30 seconds between checks

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Date.now() - startTime;
    onProgress?.(`Checking backend... (${Math.round(elapsed / 1000)}s elapsed)`, elapsed);

    const health = await checkApiHealth();

    if (health.available && health.database) {
      onProgress?.('Backend is ready!', elapsed);
      return true;
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Exponential backoff up to max interval
    waitTime = Math.min(waitTime * 1.5, maxInterval);
  }

  return false;
}
