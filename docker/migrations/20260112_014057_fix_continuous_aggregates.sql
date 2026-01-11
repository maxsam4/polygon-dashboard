-- Migration: Fix continuous aggregate policies for full history refresh
-- The original policy only looked back 1 day, missing older data for cumulative charts

-- Remove existing policies and add new ones with larger offsets
SELECT remove_continuous_aggregate_policy('blocks_1min_agg', if_exists => TRUE);
SELECT remove_continuous_aggregate_policy('blocks_1hour_agg', if_exists => TRUE);

-- Re-add with larger start_offset (1 year for hourly, 1 week for minute)
-- The minute aggregate doesn't need much history since it's for short time ranges
SELECT add_continuous_aggregate_policy('blocks_1min_agg',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);

-- The hourly aggregate needs full history for cumulative charts
SELECT add_continuous_aggregate_policy('blocks_1hour_agg',
  start_offset => INTERVAL '1 year',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

-- Refresh both aggregates with all historical data
-- This may take a while on large datasets
CALL refresh_continuous_aggregate('blocks_1min_agg', NULL, NULL);
CALL refresh_continuous_aggregate('blocks_1hour_agg', NULL, NULL);
