-- RPC call statistics table for tracking endpoint performance
CREATE TABLE IF NOT EXISTS rpc_call_stats (
  timestamp TIMESTAMPTZ NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  is_timeout BOOLEAN NOT NULL DEFAULT FALSE,
  response_time_ms INTEGER NOT NULL,
  error_message TEXT
);

SELECT create_hypertable('rpc_call_stats', 'timestamp',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_rpc_stats_endpoint_ts
  ON rpc_call_stats (endpoint, timestamp DESC);

ALTER TABLE rpc_call_stats SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'endpoint,method',
  timescaledb.compress_orderby = 'timestamp DESC'
);

SELECT add_compression_policy('rpc_call_stats', INTERVAL '7 days', if_not_exists => true);
SELECT add_retention_policy('rpc_call_stats', INTERVAL '30 days', if_not_exists => true);
