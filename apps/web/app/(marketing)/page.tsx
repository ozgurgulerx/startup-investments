import { getLatestMetrics } from '@/lib/data';
import LandingContent from './landing-content';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const { metrics, latestPeriod } = await getLatestMetrics();
  return <LandingContent metrics={metrics} latestPeriod={latestPeriod} />;
}
