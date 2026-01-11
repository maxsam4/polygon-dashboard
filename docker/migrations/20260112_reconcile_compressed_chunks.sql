-- Migration: Reconcile finality data in compressed chunks
-- This script decompresses chunks one at a time, updates finality, then recompresses
-- Run this manually when needed - it may take several hours for large datasets
--
-- IMPORTANT: This is a long-running operation. Consider running in a screen/tmux session.
-- You can stop and resume safely - the process is idempotent.

DO $$
DECLARE
    chunk_record RECORD;
    chunks_processed INT := 0;
    total_updated BIGINT := 0;
    chunk_updated BIGINT;
    start_time TIMESTAMPTZ;
    chunk_start TIMESTAMPTZ;
BEGIN
    start_time := clock_timestamp();
    RAISE NOTICE 'Starting compressed chunk reconciliation at %', start_time;

    -- Process each compressed chunk from oldest to newest
    FOR chunk_record IN
        SELECT
            chunk_schema,
            chunk_name,
            range_start,
            range_end,
            hypertable_name
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'blocks'
          AND is_compressed = true
        ORDER BY range_start ASC
    LOOP
        chunk_start := clock_timestamp();
        RAISE NOTICE 'Processing chunk % (% to %)',
            chunk_record.chunk_name,
            chunk_record.range_start,
            chunk_record.range_end;

        -- Decompress the chunk
        RAISE NOTICE '  Decompressing...';
        EXECUTE format(
            'SELECT decompress_chunk(%L)',
            format('%I.%I', chunk_record.chunk_schema, chunk_record.chunk_name)
        );

        -- Update finality data for blocks in this time range
        RAISE NOTICE '  Updating finality data...';
        WITH updated AS (
            UPDATE blocks b
            SET
                finalized = TRUE,
                finalized_at = m.timestamp,
                milestone_id = m.milestone_id,
                time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
                updated_at = NOW()
            FROM milestones m
            WHERE b.timestamp >= chunk_record.range_start
              AND b.timestamp < chunk_record.range_end
              AND b.block_number BETWEEN m.start_block AND m.end_block
              AND b.finalized = FALSE
            RETURNING 1
        )
        SELECT COUNT(*) INTO chunk_updated FROM updated;

        total_updated := total_updated + chunk_updated;

        -- Recompress the chunk
        RAISE NOTICE '  Recompressing...';
        EXECUTE format(
            'SELECT compress_chunk(%L)',
            format('%I.%I', chunk_record.chunk_schema, chunk_record.chunk_name)
        );

        chunks_processed := chunks_processed + 1;
        RAISE NOTICE '  Chunk % complete: % blocks updated in %',
            chunk_record.chunk_name,
            chunk_updated,
            clock_timestamp() - chunk_start;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '=== RECONCILIATION COMPLETE ===';
    RAISE NOTICE 'Total chunks processed: %', chunks_processed;
    RAISE NOTICE 'Total blocks updated: %', total_updated;
    RAISE NOTICE 'Total time: %', clock_timestamp() - start_time;
END $$;

-- Verify results
SELECT
    COUNT(*) as total_blocks,
    COUNT(*) FILTER (WHERE finalized = TRUE) as finalized,
    COUNT(*) FILTER (WHERE finalized = FALSE) as unfinalized,
    ROUND(100.0 * COUNT(*) FILTER (WHERE finalized = TRUE) / COUNT(*), 2) as pct_finalized
FROM blocks;
