-- Sample seed data for development
-- Run after initial migration

-- Sample Investors
INSERT INTO investors (name, type, headquarters_country) VALUES
    ('Sequoia Capital', 'VC', 'United States'),
    ('Andreessen Horowitz', 'VC', 'United States'),
    ('Index Ventures', 'VC', 'United Kingdom'),
    ('Accel', 'VC', 'United States'),
    ('Lightspeed Venture Partners', 'VC', 'United States')
ON CONFLICT (name) DO NOTHING;

-- Note: Run actual data import from CSV using the analysis scripts
