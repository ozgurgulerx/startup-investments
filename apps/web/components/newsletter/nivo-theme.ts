export const NEWSLETTER_THEME = {
  text: { fontSize: 11, fill: 'hsl(30, 10%, 65%)' },
  axis: {
    ticks: { text: { fill: 'hsl(30, 10%, 55%)', fontSize: 11 } },
    legend: { text: { fill: 'hsl(30, 10%, 65%)', fontSize: 12 } },
  },
  grid: { line: { stroke: 'hsl(220, 15%, 20%)' } },
  tooltip: {
    container: {
      background: 'hsl(220, 18%, 10%)',
      border: '1px solid hsl(220, 15%, 25%)',
      color: 'hsl(30, 10%, 80%)',
      fontSize: 13,
      borderRadius: 6,
      padding: '8px 12px',
    },
  },
};

/* ── LinkedIn / light-background theme ── */

export const LINKEDIN_THEME = {
  text: { fontSize: 13, fill: 'hsl(220, 15%, 25%)' },
  axis: {
    ticks: { text: { fill: 'hsl(220, 10%, 35%)', fontSize: 12 } },
    legend: { text: { fill: 'hsl(220, 15%, 25%)', fontSize: 13 } },
  },
  grid: { line: { stroke: 'hsl(220, 15%, 88%)' } },
  tooltip: {
    container: {
      background: '#ffffff',
      border: '1px solid hsl(220, 15%, 85%)',
      color: 'hsl(220, 15%, 25%)',
      fontSize: 13,
      borderRadius: 6,
      padding: '8px 12px',
    },
  },
};

export const LINKEDIN_STAGE_FILLS = [
  'hsl(220, 35%, 45%)',   // Pre-Seed
  'hsl(192, 60%, 40%)',   // Seed
  'hsl(40, 60%, 45%)',    // Series A
  'hsl(25, 55%, 44%)',    // Series B
  'hsl(340, 40%, 44%)',   // Series C+
];

export const LINKEDIN_CATEGORY_FILLS: Record<string, string> = {
  'Generative AI / Foundation Models': 'hsl(40, 60%, 45%)',
  'Robotics & Physical AI': 'hsl(192, 65%, 38%)',
  'Enterprise SaaS + AI': 'hsl(220, 35%, 40%)',
  'AI Infrastructure': 'hsl(260, 40%, 44%)',
  'Fintech AI': 'hsl(160, 45%, 36%)',
  'Security AI': 'hsl(340, 35%, 40%)',
  'Healthcare AI': 'hsl(200, 45%, 40%)',
  'Agentic AI': 'hsl(25, 55%, 44%)',
};

export const LINKEDIN_GENAI_FILLS: Record<string, string> = {
  core: 'hsl(40, 60%, 45%)',
  none: 'hsl(220, 30%, 45%)',
  unclear: 'hsl(220, 20%, 40%)',
  tooling: 'hsl(192, 60%, 40%)',
  enhancement: 'hsl(160, 45%, 36%)',
};

export const LINKEDIN_GEO_FILLS = [
  'hsl(192, 65%, 38%)',
  'hsl(260, 40%, 44%)',
  'hsl(40, 60%, 45%)',
  'hsl(220, 35%, 40%)',
  'hsl(160, 45%, 36%)',
];
