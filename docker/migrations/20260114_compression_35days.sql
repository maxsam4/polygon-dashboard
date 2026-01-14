-- Update compression policy from 7 days to 35 days
-- This gives more breathing room for queries and reduces decompression overhead

-- Remove old policy
SELECT remove_compression_policy('blocks');

-- Add new policy with 35 days
SELECT add_compression_policy('blocks', INTERVAL '35 days');

-- Note: Existing compressed chunks will remain compressed
-- Only new chunks will use the new 35-day policy
-- To decompress existing chunks if needed, use:
-- SELECT decompress_chunk(i) FROM show_chunks('blocks') AS i WHERE is_compressed(i);
