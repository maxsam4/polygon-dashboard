-- Migration: Backfill gas_target_pct for existing blocks within compression window
-- Pre-Lisovo blocks get their protocol default (50% pre-Dandeli, 65% post-Dandeli)

UPDATE blocks
SET gas_target_pct = CASE
  WHEN block_number < 81424000 THEN 50.0
  ELSE 65.0
END
WHERE timestamp >= NOW() - INTERVAL '35 days'
  AND gas_target_pct IS NULL;
