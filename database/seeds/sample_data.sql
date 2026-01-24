-- =============================================================================
-- Sample seed data for local development
-- Run: pnpm db:seed
-- =============================================================================

-- Sample Investors
INSERT INTO investors (name, type, headquarters_country) VALUES
    ('Sequoia Capital', 'VC', 'United States'),
    ('Andreessen Horowitz', 'VC', 'United States'),
    ('Index Ventures', 'VC', 'United Kingdom'),
    ('Accel', 'VC', 'United States'),
    ('Lightspeed Venture Partners', 'VC', 'United States'),
    ('Benchmark', 'VC', 'United States'),
    ('Greylock Partners', 'VC', 'United States'),
    ('General Catalyst', 'VC', 'United States'),
    ('NEA', 'VC', 'United States'),
    ('Founders Fund', 'VC', 'United States')
ON CONFLICT (name) DO NOTHING;

-- Sample Startups
INSERT INTO startups (name, description, website, headquarters_city, headquarters_country, continent, industry, pattern, stage, employee_count, genai_native) VALUES
    ('AI Copilot Labs', 'Building AI-powered coding assistants for developers', 'https://aicopilotlabs.com', 'San Francisco', 'United States', 'north_america', 'Developer Tools', 'agentic', 'Series A', 45, true),
    ('DataMesh AI', 'Enterprise data integration with AI', 'https://datameshai.com', 'New York', 'United States', 'north_america', 'Enterprise Software', 'vertical-data', 'Series B', 120, true),
    ('HealthBot', 'AI-powered healthcare diagnostics', 'https://healthbot.ai', 'Boston', 'United States', 'north_america', 'Healthcare', 'micro-model', 'Seed', 15, true),
    ('LegalAI Pro', 'Automated legal document analysis', 'https://legalai.pro', 'London', 'United Kingdom', 'europe', 'Legal Tech', 'rag', 'Series A', 35, true),
    ('FinanceGPT', 'AI financial advisor platform', 'https://financegpt.io', 'Singapore', 'Singapore', 'asia', 'Fintech', 'agentic', 'Series A', 50, true),
    ('SecureAI', 'AI-powered cybersecurity platform', 'https://secureai.com', 'Tel Aviv', 'Israel', 'asia', 'Cybersecurity', 'guardrail', 'Series B', 80, true),
    ('RetailMind', 'AI for retail analytics and forecasting', 'https://retailmind.ai', 'Berlin', 'Germany', 'europe', 'Retail Tech', 'flywheel', 'Seed', 20, true),
    ('EduBot', 'Personalized AI tutoring system', 'https://edubot.ai', 'Toronto', 'Canada', 'north_america', 'EdTech', 'micro-model', 'Series A', 40, true),
    ('ClimateML', 'Machine learning for climate prediction', 'https://climateml.com', 'Amsterdam', 'Netherlands', 'europe', 'Climate Tech', 'vertical-data', 'Seed', 12, true),
    ('SupplyChainAI', 'AI-optimized supply chain management', 'https://supplychainai.com', 'Shanghai', 'China', 'asia', 'Logistics', 'agentic', 'Series C', 200, true)
ON CONFLICT DO NOTHING;

-- Sample Funding Rounds (using subqueries to get startup IDs)
INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series A', 25000000, '2026-01-15', 'Sequoia Capital'
FROM startups s WHERE s.name = 'AI Copilot Labs'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series B', 75000000, '2026-01-10', 'Andreessen Horowitz'
FROM startups s WHERE s.name = 'DataMesh AI'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Seed', 5000000, '2026-01-08', 'Lightspeed Venture Partners'
FROM startups s WHERE s.name = 'HealthBot'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series A', 20000000, '2026-01-12', 'Index Ventures'
FROM startups s WHERE s.name = 'LegalAI Pro'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series A', 30000000, '2026-01-05', 'Sequoia Capital'
FROM startups s WHERE s.name = 'FinanceGPT'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series B', 60000000, '2026-01-18', 'General Catalyst'
FROM startups s WHERE s.name = 'SecureAI'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Seed', 3500000, '2026-01-20', 'Accel'
FROM startups s WHERE s.name = 'RetailMind'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series A', 18000000, '2026-01-14', 'Greylock Partners'
FROM startups s WHERE s.name = 'EduBot'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Seed', 4000000, '2026-01-22', 'Founders Fund'
FROM startups s WHERE s.name = 'ClimateML'
ON CONFLICT DO NOTHING;

INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
SELECT s.id, 'Series C', 150000000, '2026-01-02', 'NEA'
FROM startups s WHERE s.name = 'SupplyChainAI'
ON CONFLICT DO NOTHING;

-- Verify data was inserted
SELECT 'Startups:' as entity, count(*) as count FROM startups
UNION ALL
SELECT 'Investors:', count(*) FROM investors
UNION ALL
SELECT 'Funding Rounds:', count(*) FROM funding_rounds;
