// ---------------------------------------------------------------------------
// Curated Sectors — investment-friendly sector labels mapped to ontology IDs
// ---------------------------------------------------------------------------

export interface CuratedSector {
  id: string;
  label: string;
  verticalIds: string[];       // top-level ontology IDs
  subVerticalIds: string[];    // sub-vertical ontology IDs
}

export const CURATED_SECTORS: CuratedSector[] = [
  { id: 'ai_infra',         label: 'AI Infrastructure',       verticalIds: [],                            subVerticalIds: ['ai_ml_platforms'] },
  { id: 'cybersecurity',    label: 'Cybersecurity',            verticalIds: [],                            subVerticalIds: ['cybersecurity'] },
  { id: 'developer_tools',  label: 'Developer Tools',          verticalIds: [],                            subVerticalIds: ['cloud_infrastructure_devops'] },
  { id: 'data_analytics',   label: 'Data & Analytics',         verticalIds: [],                            subVerticalIds: ['data_management_analytics'] },
  { id: 'enterprise_saas',  label: 'Enterprise SaaS',          verticalIds: [],                            subVerticalIds: ['business_productivity_software'] },
  { id: 'fintech',          label: 'FinTech',                  verticalIds: ['financial_services'],         subVerticalIds: [] },
  { id: 'healthtech',       label: 'HealthTech',               verticalIds: ['healthcare_life_sciences'],   subVerticalIds: [] },
  { id: 'edtech',           label: 'EdTech',                   verticalIds: ['education'],                  subVerticalIds: [] },
  { id: 'cleantech',        label: 'CleanTech / Climate',      verticalIds: ['energy_sustainability'],      subVerticalIds: [] },
  { id: 'ecommerce',        label: 'E-Commerce & Retail',      verticalIds: ['commerce_retail'],            subVerticalIds: [] },
  { id: 'legaltech',        label: 'Legal Tech',               verticalIds: ['legal'],                      subVerticalIds: [] },
  { id: 'proptech',         label: 'PropTech',                 verticalIds: ['real_estate_construction'],   subVerticalIds: [] },
  { id: 'mobility',         label: 'Mobility & Transport',     verticalIds: ['transportation_mobility'],    subVerticalIds: [] },
  { id: 'manufacturing',    label: 'Robotics & Manufacturing', verticalIds: ['industrial_manufacturing'],   subVerticalIds: [] },
  { id: 'adtech_martech',   label: 'AdTech / MarTech',         verticalIds: [],                            subVerticalIds: ['adtech_media_tech'] },
  { id: 'gaming',           label: 'Gaming',                   verticalIds: [],                            subVerticalIds: ['gaming_video_games', 'gaming_entertainment'] },
  { id: 'agritech',         label: 'AgriTech / FoodTech',      verticalIds: ['agriculture_food'],           subVerticalIds: [] },
  { id: 'govtech',          label: 'GovTech / Defense',        verticalIds: ['government_public'],          subVerticalIds: [] },
  { id: 'consumer',         label: 'Consumer & Social',        verticalIds: ['consumer_lifestyle'],         subVerticalIds: [] },
  { id: 'supply_chain',     label: 'Supply Chain / Logistics', verticalIds: [],                            subVerticalIds: ['supply_chain_logistics_tech', 'logistics_fleet_management'] },
  { id: 'insurtech',        label: 'InsurTech',                verticalIds: [],                            subVerticalIds: ['insurtech_insurance'] },
  { id: 'crypto_defi',      label: 'Crypto / DeFi',            verticalIds: [],                            subVerticalIds: ['crypto_defi'] },
];

const SECTOR_MAP = new Map(CURATED_SECTORS.map(s => [s.id, s]));

export function findSector(id: string): CuratedSector | undefined {
  return SECTOR_MAP.get(id);
}

// ---------------------------------------------------------------------------
// SQL helpers — parameterized to avoid injection
// ---------------------------------------------------------------------------

/**
 * Builds a sector filter clause for the `startups` table using analysis_data JSONB.
 * Returns { clause, values, nextIdx } where clause is a SQL fragment like
 * `(s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' = ANY($2::text[]))`
 * and values are the bind parameters to append.
 */
export function sectorFilterForStartups(
  sector: CuratedSector,
  tableAlias: string,
  startIdx: number,
): { clause: string; values: any[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  if (sector.verticalIds.length > 0) {
    conditions.push(
      `${tableAlias}.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' = ANY($${idx}::text[])`,
    );
    values.push(sector.verticalIds);
    idx++;
  }
  if (sector.subVerticalIds.length > 0) {
    conditions.push(
      `${tableAlias}.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' = ANY($${idx}::text[])`,
    );
    values.push(sector.subVerticalIds);
    idx++;
  }

  const clause = conditions.length > 0 ? `(${conditions.join(' OR ')})` : 'TRUE';
  return { clause, values, nextIdx: idx };
}

/**
 * Builds a sector filter for queries that join to startups via a startup_id FK.
 * Returns an EXISTS subquery: EXISTS (SELECT 1 FROM startups s_sec WHERE s_sec.id = <fkExpr> AND <filter>)
 */
export function sectorExistsSubquery(
  sector: CuratedSector,
  fkExpr: string,
  startIdx: number,
): { clause: string; values: any[]; nextIdx: number } {
  const inner = sectorFilterForStartups(sector, 's_sec', startIdx);
  const clause = `EXISTS (SELECT 1 FROM startups s_sec WHERE s_sec.id = ${fkExpr} AND ${inner.clause})`;
  return { clause, values: inner.values, nextIdx: inner.nextIdx };
}
