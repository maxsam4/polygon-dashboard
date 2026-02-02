# Polygon Dashboard

Real-time Polygon blockchain analytics (gas, finality, MGAS/s, TPS).

## Production

See `prod.md` for server details. **Always deploy to local first, then prod.** Confirm with user before deploying to prod.

## Database Safety

**NEVER drop/truncate tables** - contains months of historical data.

Forbidden:
- `DROP TABLE` / `TRUNCATE TABLE`

Migrations must be additive and idempotent:
- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Place in `docker/migrations/YYYYMMDD_HHMMSS_desc.sql`

## Development

```bash
docker compose up -d --build    # Rebuild
docker compose logs -f app      # Check logs
docker compose exec db psql -U polygon -d polygon_dashboard  # DB shell
```

## Architecture

### Indexers

- `BlockIndexer` - Cursor-based forward indexer (gap-free, reorg-aware)
- `BlockBackfiller` - Backwards indexer to target block
- `MilestoneIndexer` - Cursor-based milestone indexer, writes directly to `block_finality`
- `MilestoneBackfiller` - Backwards indexer to target sequence_id, populates finality
- `PriorityFeeBackfiller` - Async priority fee calculator via receipts

### Live-Stream Service

Standalone service in `/services/live-stream`:
- WebSocket subscriptions to multiple RPC endpoints
- SSE endpoint at `/stream` for real-time block updates to frontend

### Finality

- `block_finality` table stores finality records
- `time_to_finality_sec = milestone_timestamp - block_timestamp`
- MilestoneIndexer writes finality directly on milestone arrival

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode during development
npm run test:coverage       # Generate coverage report
```

Tests are located in `src/lib/__tests__/` following the pattern `**/*.test.ts`.

## Key Patterns

- Timestamps: TIMESTAMPTZ
- Block numbers/milestone IDs: BigInt
- Gwei values: DOUBLE PRECISION
- Chunk interval: 24 hours (~43K rows/chunk) - keeps under TimescaleDB's 100K decompression limit
- Compression: After 35 days - compressed chunks cannot be efficiently updated
- Clean up dead code after you make changes
- Keep CLAUDE.md and README.md up to date with all changes
- Commit all your changes
- Run tests before pushing upstream
