-- Change chunk interval for NEW chunks only (existing chunks unaffected)
-- This reduces rows per chunk from ~300K (7 days) to ~43K (24 hours),
-- staying well under the timescaledb.max_tuples_decompressed_per_dml_per_chunk limit of 100K

SELECT set_chunk_time_interval('blocks', INTERVAL '24 hours');
