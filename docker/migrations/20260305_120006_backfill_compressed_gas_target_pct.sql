-- Migration: Backfill gas_target_pct on compressed chunks
-- Decompresses each week, updates, then recompresses
-- Pre-Dandeli (< 81424000): 50%, Post-Dandeli (>= 81424000): 65%

DO $$
DECLARE
  batch_start TIMESTAMPTZ;
  batch_end TIMESTAMPTZ;
  min_ts TIMESTAMPTZ;
  max_ts TIMESTAMPTZ;
  updated BIGINT;
  total_updated BIGINT := 0;
BEGIN
  SELECT MIN(timestamp), MAX(timestamp)
  INTO min_ts, max_ts
  FROM blocks
  WHERE gas_target_pct IS NULL;

  IF min_ts IS NULL THEN
    RAISE NOTICE 'No blocks need backfilling';
    RETURN;
  END IF;

  RAISE NOTICE 'Backfilling compressed gas_target_pct from % to %', min_ts::date, max_ts::date;

  batch_start := date_trunc('day', min_ts);
  WHILE batch_start <= max_ts LOOP
    batch_end := batch_start + INTERVAL '1 day';

    -- Decompress chunks in this range
    PERFORM decompress_chunk(c, if_compressed => true)
    FROM show_chunks('blocks', older_than => batch_end, newer_than => batch_start) c;

    -- Update the decompressed data
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

    -- Recompress chunks in this range
    PERFORM compress_chunk(c, if_not_compressed => true)
    FROM show_chunks('blocks', older_than => batch_end, newer_than => batch_start) c;

    IF updated > 0 THEN
      RAISE NOTICE 'Batch % to %: updated % rows', batch_start::date, batch_end::date, updated;
    END IF;

    batch_start := batch_end;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % total rows updated', total_updated;
END $$;
