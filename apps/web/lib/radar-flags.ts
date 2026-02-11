export function isDecisionCardsEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const ov = localStorage.getItem('buildatlas:radar-decision-cards');
    if (ov === 'true') return true;
    if (ov === 'false') return false;
  }
  return process.env.NEXT_PUBLIC_RADAR_DECISION_CARDS === 'true';
}
