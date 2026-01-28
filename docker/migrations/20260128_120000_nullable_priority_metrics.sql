-- Migration to allow null values for priority fee metrics
-- These fields are null when transaction receipt data (gasUsed) is not yet available
-- WebSocket subscriptions provide block data but not individual transaction gasUsed

-- For TimescaleDB hypertables, we need to alter the column on the main table
-- and it will propagate to all chunks

ALTER TABLE blocks ALTER COLUMN avg_priority_fee_gwei DROP NOT NULL;
ALTER TABLE blocks ALTER COLUMN total_priority_fee_gwei DROP NOT NULL;

-- Add comments to document the nullable semantics
COMMENT ON COLUMN blocks.avg_priority_fee_gwei IS 'Average priority fee per transaction. Null when receipt data not yet fetched.';
COMMENT ON COLUMN blocks.total_priority_fee_gwei IS 'Total priority fees paid in block. Null when receipt data not yet fetched.';
