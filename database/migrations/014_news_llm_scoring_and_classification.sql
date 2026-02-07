-- LLM-native classification and scoring fields for news clusters

ALTER TABLE news_clusters
    ADD COLUMN IF NOT EXISTS llm_signal_score NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS llm_confidence_score NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS llm_topic_tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS llm_story_type TEXT;

CREATE INDEX IF NOT EXISTS idx_news_clusters_llm_signal ON news_clusters(llm_signal_score DESC NULLS LAST);
