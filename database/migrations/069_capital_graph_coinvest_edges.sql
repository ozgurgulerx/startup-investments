-- Migration 069: Capital Graph Co-Invest Edges
--
-- Adds indexes optimized for investor <-> investor co-invest traversal stored
-- in capital_graph_edges with edge_type='CO_INVESTS_WITH'.

CREATE INDEX IF NOT EXISTS idx_capital_graph_coinvest_out_active
    ON capital_graph_edges(src_id, region, dst_id)
    WHERE src_type = 'investor'
      AND dst_type = 'investor'
      AND edge_type = 'CO_INVESTS_WITH'
      AND valid_to = DATE '9999-12-31';

CREATE INDEX IF NOT EXISTS idx_capital_graph_coinvest_in_active
    ON capital_graph_edges(dst_id, region, src_id)
    WHERE src_type = 'investor'
      AND dst_type = 'investor'
      AND edge_type = 'CO_INVESTS_WITH'
      AND valid_to = DATE '9999-12-31';
