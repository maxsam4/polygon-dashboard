# Polygon Dashboard

Real-time Polygon blockchain analytics (gas, finality, MGAS/s, TPS).

## Production

See `prod.md` for server details. **Always deploy to local first, then prod.** Confirm with user before deploying to prod.

## Database Safety

**NEVER drop/truncate tables** - contains 5+ years of historical data (83M+ blocks).

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

**Updating compressed chunks** - Use `decompress_chunk()` + UPDATE + `compress_chunk()` in 1-day batches (not 7-day — 43K rows/day × 7 exceeds the 100K decompression limit). May need multiple passes due to partial chunk decompression. See `20260305_120006_backfill_compressed_gas_target_pct.sql` for the pattern.

**Check for stuck queries before retrying** - Failed SSH sessions can leave queries running:
```sql
-- Find stuck queries
SELECT pid, state, query_start, substring(query, 1, 80) FROM pg_stat_activity WHERE state = 'active';
-- Terminate if needed
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pattern%' AND state = 'active';
```

## Development

```bash
docker compose up -d --build          # Rebuild all (app + indexer)
docker compose up -d --build app      # Rebuild app only
docker compose up -d --build indexer  # Rebuild indexer only
docker compose logs -f app            # Check app logs
docker compose logs -f indexer        # Check indexer logs
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

After code changes, rebuild the relevant container:
```bash
docker compose up -d --build app      # API/frontend changes
docker compose up -d --build indexer  # Indexer/worker changes
```

## Docker Environment Variables

Environment variables must be explicitly listed in `docker-compose.yml` under `environment:` to be passed to containers - they don't auto-pass from `.env`. After adding new env vars to code, add them to docker-compose.yml.

Avoid special characters (`%`, `$`, `!`) in passwords - they can break Docker Compose variable substitution.

## Edge Runtime (Middleware)

`src/middleware.ts` runs in Edge Runtime. Avoid Node.js-specific modules (`crypto`, `fs`, etc.). Use Web Crypto API: `crypto.getRandomValues()` instead of `randomBytes()`.

## Architecture

### Two-Container Architecture

The app runs as two Docker containers sharing the same database:
- **`app`** — Next.js server (HTTP, SSR, API routes). Reads worker status from `worker_status` DB table.
- **`indexer`** — Standalone Node.js process (`src/lib/workers/main.ts`). Runs all indexers, flushes status to DB every 5s, exposes `/health` on port 3003.

Both build from the same repo. The indexer compiles `src/lib/` with `tsconfig.indexer.json` (CommonJS) into `dist-indexer/`.

### Indexers

- `BlockIndexer` - Cursor-based forward indexer (gap-free, reorg-aware, inline receipt enrichment)
- `BlockBackfiller` - Backwards indexer to target block (inline receipt enrichment)
- `MilestoneIndexer` - Cursor-based milestone indexer, writes directly to `block_finality`
- `MilestoneBackfiller` - Backwards indexer to target sequence_id, populates finality

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
- **Session**: JWT token stored in HttpOnly cookie, no expiry (persists until logout or password change)
- **Secret**: Derived from admin password (sessions invalidate when password changes)
- **Password**: Set `ADMIN_PASSWORD` env var (falls back to `ADD_RATE_PASSWORD`)
- **Middleware**: `src/middleware.ts` protects `/admin/*` routes
- **Nav**: Admin and Alerts links only visible when authenticated

### Anomaly Detection

Detects anomalies in key metrics and stores them for alerting:

- **Tables**: `anomalies` (detected anomalies), `metric_thresholds` (configurable thresholds)
- **Block Ranges**: Consecutive anomalous blocks grouped into ranges via `findExtendableAnomalyRange()`
- **Thresholds**: Configurable per metric via admin panel at `/admin` (see `src/lib/constants.ts` for defaults)
- **Min Consecutive Blocks**: Per-metric filter to suppress transient spikes (applied at query time)
- **Integration**: BlockIndexer calls `checkBlocksForAnomalies()` after each batch
- **API**: `GET /api/anomalies` (filtering, pagination), `POST /api/anomalies/acknowledge` (bulk ack)
- **UI**: `/alerts` page with filters, acknowledgement controls

### Gas Target Percentage (EIP-1559 Elasticity)

Tracks the effective gas target percentage derived from consecutive blocks' baseFee changes:

- **Column**: `blocks.gas_target_pct` (DOUBLE PRECISION, nullable)
- **Table**: `eip1559_params` stores BaseFeeChangeDenominator (BFCD) values at hardfork blocks
- **Derivation**: `R = (baseFee[N] - baseFee[N-1]) / baseFee[N-1] * BFCD; gasTargetPct = gasUsed[N-1] / (R+1) / gasLimit[N-1] * 100`
- **Carry-forward**: When derivation fails (zero baseFee, zero gasUsed, numerical instability), uses last known value or protocol default (50% pre-Dandeli block 81424000, 65% post-Dandeli)
- **Modules**: `src/lib/eip1559Params.ts` (BFCD lookup), `src/lib/gas.ts` (`deriveGasTargetPct()`), `src/lib/queries/eip1559Params.ts` (DB queries)
- **Admin API**: `GET/POST /api/admin/eip1559-params` — view/add BFCD records (auth required)
- **Admin UI**: "EIP-1559 Parameters (BFCD)" card on `/admin` page
- **Chart**: "Gas Target (%)" on `/analytics` page using `gasTargetPctAvg` from continuous aggregates

### RPC Performance Tracking

Records every RPC call attempt for visibility into endpoint performance:

- **Per-call timeout**: 1.5s (`RPC_RETRY_CONFIG.CALL_TIMEOUT_MS`) via `Promise.race` — slow endpoints fail fast and retry on others
- **Transport timeout**: 10s backstop (prevents zombie connections)
- **Stats recording**: In-memory buffer with batch INSERT flush every 5s (`src/lib/rpcStats.ts`)
- **Table**: `rpc_call_stats` hypertable — timestamp, endpoint (hostname only), method, success, is_timeout, response_time_ms, error_message
  - Compressed after 7 days, retained for 30 days
  - ~1.7M rows/day at ~20 calls/sec
- **Query module**: `src/lib/queries/rpcStats.ts` — endpoint stats, method stats, time-series with percentiles
- **API**: `GET /api/admin/rpc-stats` — auth required, `?view=summary` or `?view=timeseries&bucket=5m`, max 7-day range
- **UI**: `/admin/rpc-stats` — summary cards, endpoint/method tables, p95 response time and success rate charts
- **Nav**: "RPC Stats" link visible when authenticated

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode during development
npm run test:coverage       # Generate coverage report
```

Run a single test file: `npx jest src/lib/__tests__/gas.test.ts`

Tests are located in `src/lib/__tests__/` following the pattern `**/*.test.ts`.

- `jose` is an ESM module - mock it in tests rather than configuring Jest ESM transform

## Code Organization

### Shared Utilities

- `src/lib/constants.ts` - All magic numbers, thresholds, and config constants
- `src/lib/chartSeriesConfig.ts` - Chart metric definitions (add new chart metrics here)
- `src/lib/eip1559Params.ts` - EIP-1559 BFCD lookup and gas target percentage defaults

### Hooks

- `src/hooks/useChartData.ts` - Chart data fetching with time range handling
- `src/hooks/useAdminAuth.ts` - Admin authentication state for Nav component
- `src/hooks/useRpcStats.ts` - RPC performance stats fetching with polling

### Components

- `src/components/charts/ChartTooltip.tsx` - Reusable chart tooltip component
- `src/components/charts/FullChart.tsx` - Main chart component
- `src/components/charts/ChartControls.tsx` - Time range and bucket size controls
- `src/components/AlertsBadge.tsx` - Nav badge showing recent alert count
- `src/components/ThresholdEditor.tsx` - Admin component for editing anomaly thresholds
- `src/components/rpc/RpcStatsTable.tsx` - Endpoint and method stats tables
- `src/components/rpc/RpcPerformanceChart.tsx` - Time-series performance charts

## Reliability

- **DB statement_timeout**: 30s max per query prevents runaway queries from exhausting the connection pool
- **RPC per-call timeout**: 1.5s per call via Promise.race ensures fast failover to alternate endpoints
- **RPC transport timeout**: 10s per HTTP transport call as backstop against zombie connections
- **RPC circuit breaker**: Endpoints are skipped for 30s after 5 consecutive failures, with exponential backoff on retries
- **SSE proxy reconnection**: Upstream live-stream disconnects trigger automatic reconnection with exponential backoff (max 5 retries)
- **Worker startup**: Uses `Promise.allSettled` - partial failures are logged, remaining workers continue running
- **Inline receipt enrichment**: Indefinite round-robin RPC retry ensures blocks are only inserted with complete data (all-or-nothing). Each block's receipts retry across all endpoints until success or abort.
- **Admin login rate limiting**: 5 attempts per IP per minute (in-memory)
- **App health check**: Docker healthcheck on `/api/status` enables automatic container restart
- **Indexer health check**: Docker healthcheck on `:3003/health` enables automatic container restart
- **Worker status DB flush**: In-memory status flushed to `worker_status` table every 5s for cross-container visibility

## Key Patterns

- **Code review with Codex**: Run `codex review --commit HEAD` to get an OpenAI Codex review of the last commit
- Timestamps: TIMESTAMPTZ
- Block numbers/milestone IDs: BigInt
- Gwei values: DOUBLE PRECISION
- Chunk interval: 24 hours (~43K rows/chunk) - keeps under TimescaleDB's 100K decompression limit
- Compression: After 35 days - compressed chunks cannot be efficiently updated
- **Adding a column to `blocks`** - Update all of: `Block` interface, `BlockRow` interface, `rowToBlock()`, `insertBlock()` params + ON CONFLICT, `insertBlocksBatch()` params + PARAMS_PER_BLOCK, `reorgHandler.ts` block construction, test fixtures (`__tests__/fixtures/blocks.ts`, `receiptEnricher.test.ts`). Optionally: `BlockDataUI`, `ChartDataPoint`, continuous aggregates, chart queries.
- **lightweight-charts `setVisibleRange`** crashes with "Value is null" when no series has data points. Always guard with a `hasAnyData` check before calling `setVisibleRange()` or `fitContent()`.
- **Backfiller processes backwards** - `BlockBackfiller` goes ascending within a batch but backwards across batches. Never use class-level carry-forward state (it would propagate newer values into older blocks). Use batch-scoped local variables instead.
- **Block time post-fork (block 86478656, 2026-05-06 14:22:35 UTC)** - Polygon switched from a steady 2s to a 1.75s average produced as a 2,2,2,1 pattern of integer-second gaps. Standard `eth_getBlockByNumber` does not expose sub-second timestamps; bor has no extended timestamp method; Heimdall has nanosecond block times but those are consensus blocks, not 1:1 with bor blocks. Per-block charts will look jaggy (1s/2s alternation); aggregation over ≥1m buckets smooths this naturally. Use `BLOCK_TIME_175S_FORK_BLOCK` from `src/lib/constants.ts` when splitting calculations across the fork.
- Magic numbers go in `src/lib/constants.ts`
- Shared formatting functions go in dedicated utility modules
- Clean up dead code after you make changes
- Keep CLAUDE.md and README.md up to date with all changes
- Commit all your changes
- Run tests before pushing upstream
