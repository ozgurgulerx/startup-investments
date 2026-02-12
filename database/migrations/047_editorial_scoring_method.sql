-- 047_editorial_scoring_method.sql
-- Extend the scoring_method CHECK constraint to include 'editorial_postgate'.
-- This allows the post-gate editorial process to tag its decisions in
-- news_item_decisions without violating the CHECK constraint.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'news_item_decisions'
          AND constraint_name = 'chk_item_decisions_scoring_method'
    ) THEN
        ALTER TABLE news_item_decisions
            DROP CONSTRAINT chk_item_decisions_scoring_method;
        ALTER TABLE news_item_decisions
            ADD CONSTRAINT chk_item_decisions_scoring_method
            CHECK (scoring_method IN ('heuristic', 'llm_judge', 'hybrid', 'editorial_postgate'));
    END IF;
END $$;
