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

**Timestamp filters must be < 7 days** - Chunks are compressed after 35 days. Queries spanning compressed chunks are slow. Always use timestamp filters within 7 days for hypertable queries (blocks, block_finality).

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

## Git Worktrees

.worktrees/ exists and is properly ignored.
Feature branches use worktrees for isolated development:
- Location: `.worktrees/<feature-name>`
- Branch: `feature/<feature-name>`
- **Always clean up after merge**: Remove worktree and delete branch

```bash
git worktree add .worktrees/my-feature -b feature/my-feature  # Create
git worktree remove .worktrees/my-feature && git branch -d feature/my-feature  # Clean up after merge
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

## Docker Environment Variables

Environment variables must be explicitly listed in `docker-compose.yml` under `environment:` to be passed to containers - they don't auto-pass from `.env`. After adding new env vars to code, add them to docker-compose.yml.

Avoid special characters (`%`, `$`, `!`) in passwords - they can break Docker Compose variable substitution.

## Edge Runtime (Middleware)

`src/middleware.ts` runs in Edge Runtime. Avoid Node.js-specific modules (`crypto`, `fs`, etc.). Use Web Crypto API: `crypto.getRandomValues()` instead of `randomBytes()`.

## Architecture

### Indexers

- `BlockIndexer` - Cursor-based forward indexer (gap-free, reorg-aware, inline receipt enrichment)
- `BlockBackfiller` - Backwards indexer to target block (inline receipt enrichment)
- `MilestoneIndexer` - Cursor-based milestone indexer, writes directly to `block_finality`
- `MilestoneBackfiller` - Backwards indexer to target sequence_id, populates finality
- `HistoricalPriorityFeeBackfiller` - Fills priority fee data for legacy blocks inserted before inline enrichment

### Live-Stream Service

Standalone service in `/services/live-stream`:
- WebSocket subscriptions to multiple RPC endpoints
- SSE endpoint at `/stream` for real-time block updates to frontend

### Finality

- `block_finality` table stores finality records
- `time_to_finality_sec = milestone_timestamp - block_timestamp`
- MilestoneIndexer writes finality directly on milestone arrival

### Admin Authentication

Password-protected admin panel at `/admin` with JWT session authentication:

- **Login**: `/admin/login` - password form, creates session cookie
- **Session**: JWT token stored in HttpOnly cookie, 24-hour expiry
- **Secret**: Auto-generated on server start (sessions invalidate on restart), or set `ADMIN_SESSION_SECRET` for persistence
- **Password**: Set `ADMIN_PASSWORD` env var (falls back to `ADD_RATE_PASSWORD`)
- **Middleware**: `src/middleware.ts` protects `/admin/*` and `/alerts` routes
- **Nav**: Admin and Alerts links only visible when authenticated

### Anomaly Detection

Detects anomalies in key metrics and stores them for alerting:

- **Tables**: `anomalies` (detected anomalies), `metric_thresholds` (configurable thresholds)
- **Block Ranges**: Consecutive blocks with the same anomaly are grouped into ranges (e.g., "blocks 100-105" instead of 6 separate alerts)
  - `start_block_number` and `end_block_number` columns define the range
  - Ranges are extended across indexer batches via `findExtendableAnomalyRange()`
  - Different severities or metric types are never merged
- **Thresholds**: Configurable via admin panel at `/admin`
  - Gas Price: warning 10-2000 Gwei, critical 2-5000 Gwei
  - Block Time: warning > 3s, critical 1-5s
  - Finality: warning > 10s, critical > 30s
  - TPS: warning 5-2000, critical > 3000
  - MGAS/s: warning < 2
  - Reorgs: Always critical (exempt from min_consecutive_blocks filter)
- **Min Consecutive Blocks**: Each metric can require N consecutive blocks with anomaly before showing
  - Set via admin panel per metric type
  - Filters transient spikes (e.g., gas_price defaults to 2 blocks)
  - Applied at query time in `getAnomalies()` and `getAnomalyCount()`
  - Reorgs always shown regardless of this setting
- **Integration**: BlockIndexer calls `checkBlocksForAnomalies()` after each batch
- **API**:
  - `GET /api/anomalies` - filtering, pagination, count-only mode (requires auth)
  - `POST /api/anomalies/acknowledge` - acknowledge alerts by id(s) or all in time range
- **UI**: `/alerts` page with stats, filters, sortable table, and acknowledgement controls
- **Acknowledgement**: Alerts can be acknowledged to remove them from the nav badge count
  - Select individual alerts or use "Acknowledge All" for bulk operations
  - Acknowledged alerts shown with reduced opacity and "ack" status badge
  - Filter by status: All / Unacknowledged / Acknowledged

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode during development
npm run test:coverage       # Generate coverage report
```

Tests are located in `src/lib/__tests__/` following the pattern `**/*.test.ts`.

- `jose` is an ESM module - mock it in tests rather than configuring Jest ESM transform

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
- `src/hooks/useAdminAuth.ts` - Admin authentication state for Nav component

### Components

- `src/components/charts/ChartTooltip.tsx` - Reusable chart tooltip component
- `src/components/charts/FullChart.tsx` - Main chart component
- `src/components/charts/ChartControls.tsx` - Time range and bucket size controls
- `src/components/AlertsBadge.tsx` - Nav badge showing recent alert count
- `src/components/ThresholdEditor.tsx` - Admin component for editing anomaly thresholds

## Reliability

- **DB statement_timeout**: 30s max per query prevents runaway queries from exhausting the connection pool
- **RPC request timeout**: 30s per HTTP transport call prevents hanging on unresponsive endpoints
- **RPC circuit breaker**: Endpoints are skipped for 30s after 5 consecutive failures, with exponential backoff on retries
- **SSE proxy reconnection**: Upstream live-stream disconnects trigger automatic reconnection with exponential backoff (max 5 retries)
- **Worker startup**: Uses `Promise.allSettled` - partial failures are logged, remaining workers continue running
- **Inline receipt enrichment**: BlockIndexer and BlockBackfiller fetch receipts before insert for complete data; failures are caught by HistoricalPriorityFeeBackfiller
- **Admin login rate limiting**: 5 attempts per IP per minute (in-memory)
- **App health check**: Docker healthcheck on `/api/status` enables automatic container restart

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
