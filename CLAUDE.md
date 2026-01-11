# Polygon Dashboard - Development Guidelines

## Project Overview

Real-time Polygon blockchain analytics dashboard tracking gas prices, finality times, MGAS/s, and TPS.

## Production Deployment

**See `prod.md` for production server details and deployment commands.** This file contains SSH access, deployment scripts, and server-specific notes. It is gitignored for security.

## CRITICAL: Database Safety Rules

**NEVER reset, drop, or truncate database tables.** The database contains weeks/months of historical blockchain data that takes significant time to backfill.

### Forbidden Actions
- `docker compose down -v` (deletes volumes)
- `DROP TABLE` or `TRUNCATE TABLE`
- Recreating the database container from scratch
- Any action that loses existing data

### Safe Migration Practices
- Use `CREATE TABLE IF NOT EXISTS` for new tables
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for new columns
- Migrations must be additive and idempotent
- Test migrations on a backup/copy before production
- Never modify init.sql expecting it to affect existing databases

## Development Workflow

### After Making Changes

Always apply changes to the locally deployed Docker instance:

```bash
# Rebuild and restart containers
docker compose up -d --build

# Or for a clean restart
docker compose down && docker compose up -d --build

# Check logs
docker compose logs -f app
```

### Database Migrations

When schema changes are needed for deployed instances:

1. Create migration SQL in `docker/migrations/` with timestamp prefix: `YYYYMMDD_HHMMSS_description.sql`
2. Migration should be idempotent (safe to run multiple times)
3. Apply to running instance:

```bash
# Connect to running database
docker compose exec db psql -U polygon -d polygon_dashboard

# Or run migration file directly
docker compose exec -T db psql -U polygon -d polygon_dashboard < docker/migrations/YYYYMMDD_HHMMSS_description.sql
```

### Making Changes Deployable to Running Instances

1. **Schema Changes**: Always create migration files, never rely on init.sql for existing deployments
2. **Data Changes**: Use UPDATE/INSERT statements that are idempotent
3. **Code Changes**: Ensure backwards compatibility or coordinate with migrations
4. **Config Changes**: Use environment variables, document in README

## Architecture

### Workers (Background Processes)

- **LivePoller**: Polls for new blocks every 2s (with batch recovery when lagging)
- **Backfiller**: Fills historical blocks going backwards
- **MilestonePoller**: Polls for new milestones from Heimdall
- **MilestoneBackfiller**: Fills historical milestones
- **FinalityReconciler**: Matches blocks to milestones every 10s
- **GapAnalyzer**: Detects gaps in blocks, milestones, and finality data (runs every 5 min)
- **Gapfiller**: Fills detected gaps from the gaps table

### Finality Tracking (Reconciliation Model)

- Workers only INSERT data, never set finality directly
- FinalityReconciler matches blocks to milestones via SQL JOIN
- Atomic reconciliation eliminates race conditions
- Works regardless of block/milestone arrival order

### Key Patterns

- All timestamps stored as TIMESTAMPTZ with full precision
- Percentages displayed with 2 decimal places minimum
- Use BigInt for block numbers and milestone IDs
- All gwei values stored as DOUBLE PRECISION

## Common Tasks

### Reset Finality Data (for reconciliation)

```sql
UPDATE blocks SET
  finalized = FALSE,
  finalized_at = NULL,
  milestone_id = NULL,
  time_to_finality_sec = NULL
WHERE finalized = TRUE;
```

### Check Data Coverage

```sql
-- Blocks coverage
SELECT MIN(block_number), MAX(block_number), COUNT(*) FROM blocks;

-- Milestones coverage
SELECT MIN(milestone_id), MAX(milestone_id), COUNT(*) FROM milestones;

-- Unfinalized blocks
SELECT COUNT(*) FROM blocks WHERE finalized = FALSE;
```

### Trigger Full Reconciliation

The FinalityReconciler runs automatically, but to force immediate reconciliation:

```sql
UPDATE blocks b
SET
  finalized = TRUE,
  finalized_at = m.timestamp,
  milestone_id = m.milestone_id,
  time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
  updated_at = NOW()
FROM milestones m
WHERE b.block_number BETWEEN m.start_block AND m.end_block
  AND b.finalized = FALSE;
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `POLYGON_RPC_URLS` | - | Comma-separated RPC endpoints |
| `HEIMDALL_API_URLS` | - | Comma-separated Heimdall endpoints |
| `BACKFILL_TO_BLOCK` | 50000000 | Target block for backfill |
| `BACKFILL_BATCH_SIZE` | 100 | Blocks per backfill batch |
| `RPC_DELAY_MS` | 100 | Delay between RPC calls |
| `LIVE_POLLER_BATCH_SIZE` | 100 | Max blocks to process in one batch when catching up |
