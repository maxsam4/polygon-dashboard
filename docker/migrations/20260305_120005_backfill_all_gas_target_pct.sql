-- Migration: Backfill gas_target_pct for ALL blocks
-- Processes in 7-day batches to stay within statement_timeout and decompression limits
-- Pre-Dandeli (< 81424000): 50%, Post-Dandeli (>= 81424000): 65%

DO $$
DECLARE
  batch_start DATE;
  batch_end DATE;
  min_ts DATE;
  max_ts DATE;
  updated BIGINT;
  total_updated BIGINT := 0;
BEGIN
  SELECT MIN(timestamp)::date, MAX(timestamp)::date
  INTO min_ts, max_ts
  FROM blocks
  WHERE gas_target_pct IS NULL;

  IF min_ts IS NULL THEN
    RAISE NOTICE 'No blocks need backfilling';
    RETURN;
  END IF;

  RAISE NOTICE 'Backfilling gas_target_pct from % to %', min_ts, max_ts;

  batch_start := min_ts;
  WHILE batch_start <= max_ts LOOP
    batch_end := batch_start + INTERVAL '7 days';

    UPDATE blocks
    SET gas_target_pct = CASE
      WHEN block_number < 81424000 THEN 50.0
      ELSE 65.0
    END
    WHERE timestamp >= batch_start
      AND timestamp < batch_end
      AND gas_target_pct IS NULL;

    GET DIAGNOSTICS updated = ROW_COUNT;
    total_updated := total_updated + updated;

    IF updated > 0 THEN
      RAISE NOTICE 'Batch % to %: updated % rows', batch_start, batch_end, updated;
    END IF;

    batch_start := batch_end::date;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % total rows updated', total_updated;
END $$;
