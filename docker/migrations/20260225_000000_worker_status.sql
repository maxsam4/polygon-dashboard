-- Worker status table for cross-container status reporting
-- The indexer container flushes status here; the Next.js app reads it via API
CREATE TABLE IF NOT EXISTS worker_status (
    worker_name VARCHAR(50) PRIMARY KEY,
    state VARCHAR(20) NOT NULL DEFAULT 'stopped',
    last_run_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error TEXT,
    items_processed BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
