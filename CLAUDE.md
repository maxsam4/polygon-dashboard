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

## TimescaleDB Performance

**UPDATE queries must include timestamp** - The hypertable is partitioned by timestamp. Queries filtering only by `block_number` scan all 80M+ rows. Always include timestamp in WHERE clause:
```sql
-- SLOW (scans all chunks):
UPDATE blocks SET x = y WHERE block_number = 12345;

-- FAST (uses primary key):
UPDATE blocks SET x = y WHERE (timestamp, block_number) = ('2026-02-03 09:25:58+00', 12345);
```

**Check for stuck queries before retrying** - Failed SSH sessions can leave queries running:
```sql
-- Find stuck queries
SELECT pid, state, query_start, substring(query, 1, 80) FROM pg_stat_activity WHERE state = 'active';
-- Terminate if needed
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pattern%' AND state = 'active';
```

## Development

```bash
docker compose up -d --build    # Rebuild
docker compose logs -f app      # Check logs
docker compose exec db psql -U polygon -d polygon_dashboard  # DB shell
```

## Running Migrations

Migrations aren't auto-mounted in Docker. Execute via stdin:
```bash
docker compose exec -T db psql -U polygon -d polygon_dashboard < docker/migrations/FILENAME.sql
```

After code changes, rebuild the container to test new API routes:
```bash
docker compose up -d --build app
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

### Anomaly Detection

Detects anomalies in key metrics and stores them for alerting:

- **Tables**: `anomalies` (detected anomalies), `metric_thresholds` (configurable thresholds)
- **Thresholds** (calibrated from Feb 2026 data):
  - Gas Price: warning > 1200 Gwei, critical > 1600 Gwei
  - Block Time: warning > 2.5s, critical > 3s
  - Finality: warning > 4s, critical > 6s
  - TPS: warning < 30 or > 130, critical < 15 or > 160
  - MGAS/s: warning < 5 or > 32, critical < 2 or > 36
  - Reorgs: Always critical
- **Integration**: BlockIndexer calls `checkBlocksForAnomalies()` after each batch
- **API**: `GET /api/anomalies` with filtering, pagination, and count-only mode
- **UI**: `/alerts` page with stats, filters, and sortable table

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode during development
npm run test:coverage       # Generate coverage report
```

Tests are located in `src/lib/__tests__/` following the pattern `**/*.test.ts`.

## Code Organization

### Shared Utilities

- `src/lib/constants.ts` - Centralized constants (UI_CONSTANTS, RPC_RETRY_CONFIG, STATUS_THRESHOLDS, ANOMALY_THRESHOLDS, GWEI, bucket sizes)
- `src/lib/dateUtils.ts` - Date/time formatting utilities for charts
- `src/lib/statusUtils.ts` - Status page utilities (formatAge, formatSpeed, calculateSpeeds)
- `src/lib/chartSeriesConfig.ts` - Chart series configurations and metric definitions
- `src/lib/utils.ts` - General utilities (sleep, formatPol)
- `src/lib/anomalyDetector.ts` - Anomaly detection logic for block metrics

### Hooks

- `src/hooks/useChartData.ts` - Chart data fetching with time range handling

### Components

- `src/components/charts/ChartTooltip.tsx` - Reusable chart tooltip component
- `src/components/charts/FullChart.tsx` - Main chart component
- `src/components/charts/ChartControls.tsx` - Time range and bucket size controls
- `src/components/AlertsBadge.tsx` - Nav badge showing recent alert count

## Key Patterns

- Timestamps: TIMESTAMPTZ
- Block numbers/milestone IDs: BigInt
- Gwei values: DOUBLE PRECISION
- Chunk interval: 24 hours (~43K rows/chunk) - keeps under TimescaleDB's 100K decompression limit
- Compression: After 35 days - compressed chunks cannot be efficiently updated
- Magic numbers go in `src/lib/constants.ts`
- Shared formatting functions go in dedicated utility modules
- Clean up dead code after you make changes
- Keep CLAUDE.md and README.md up to date with all changes
- Commit all your changes
- Run tests before pushing upstream
