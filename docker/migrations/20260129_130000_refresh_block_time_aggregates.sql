-- Refresh continuous aggregates after fixing block_time_sec values
-- This recalculates aggregated metrics for the last 3 days
--
-- IMPORTANT: These CALL statements must be run outside a transaction.
-- Run each command separately after applying the migration:
--
-- For local:
--   docker compose exec db psql -U polygon -d polygon_dashboard \
--     -c "CALL refresh_continuous_aggregate('blocks_1min_agg', NOW() - INTERVAL '3 days', NOW());"
--   docker compose exec db psql -U polygon -d polygon_dashboard \
--     -c "CALL refresh_continuous_aggregate('blocks_1hour_agg', NOW() - INTERVAL '3 days', NOW());"
--
-- For production (see prod.md for connection details):
--   psql -U polygon -d polygon_dashboard \
--     -c "CALL refresh_continuous_aggregate('blocks_1min_agg', NOW() - INTERVAL '3 days', NOW());"
--   psql -U polygon -d polygon_dashboard \
--     -c "CALL refresh_continuous_aggregate('blocks_1hour_agg', NOW() - INTERVAL '3 days', NOW());"

SELECT 'Run aggregate refresh commands manually after this migration' AS note;
