-- Add 'block_time' as a valid gap type for blocks with null block_time_sec
-- This allows GapAnalyzer to detect and Gapfiller to fill blocks with missing block time data

-- Drop the old constraint
ALTER TABLE gaps DROP CONSTRAINT IF EXISTS gaps_valid_type;

-- Add the new constraint with block_time included
ALTER TABLE gaps ADD CONSTRAINT gaps_valid_type
  CHECK (gap_type IN ('block', 'milestone', 'finality', 'priority_fee', 'block_time'));

-- One-time fix: Recalculate block_time_sec for blocks with incorrect values
-- Only affects uncompressed chunks (last 3 days to avoid TimescaleDB decompression limits)
UPDATE blocks b1
SET
  block_time_sec = EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp)),
  mgas_per_sec = CASE
    WHEN EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp)) > 0
    THEN b1.gas_used::float / EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp)) / 1000000
    ELSE NULL
  END,
  tps = CASE
    WHEN EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp)) > 0
    THEN b1.tx_count::float / EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp))
    ELSE NULL
  END,
  updated_at = NOW()
FROM blocks b2
WHERE b1.block_number = b2.block_number + 1
  AND b1.block_time_sec != EXTRACT(EPOCH FROM (b1.timestamp - b2.timestamp))
  AND b1.timestamp >= NOW() - INTERVAL '3 days';
