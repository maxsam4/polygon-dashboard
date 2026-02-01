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

### Workers (Two Systems)

**Legacy System** (default):
- `LivePoller` - Polls RPC every 2s or uses WebSocket subscriptions
- `Backfiller` - Backfills blocks from current lowest to target (default 50M)
- `MilestonePoller` - Polls Heimdall API for new milestones
- `MilestoneBackfiller` - Backfills milestones from Heimdall
- `FinalityReconciler` - Matches blocks to milestones via SQL JOIN (100ms)
- `GapAnalyzer` - Detects gaps in blocks/milestones/finality (5m)
- `Gapfiller` - Fills identified gaps from RPC/Heimdall

**New Indexer System** (`USE_NEW_BLOCK_INDEXER=true`, `USE_NEW_MILESTONE_INDEXER=true`):
- `BlockIndexer` - Cursor-based forward indexer (gap-free, reorg-aware)
- `BlockBackfiller` - Backwards indexer to target block
- `MilestoneIndexer` - Cursor-based milestone indexer, writes directly to `block_finality`
- `PriorityFeeBackfiller` - Async priority fee calculator via receipts

**Live-Stream Service** (`USE_LIVE_STREAM_SERVICE=true`):
- Standalone service in `/services/live-stream`
- WebSocket subscriptions to multiple RPC endpoints
- SSE endpoint at `/stream` for real-time block updates

### Finality

- `block_finality` table stores finality records
- `time_to_finality_sec = milestone_timestamp - block_timestamp`
- Legacy: FinalityReconciler matches unfinalized blocks to milestones
- New: MilestoneIndexer writes finality directly on milestone arrival

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
- Compressed chunks (>30 days): Cannot efficiently update finality
- Clean up dead code after you make changes
- Keep CLAUDE.md and README.md up to date with all changes
- Commit all your changes
