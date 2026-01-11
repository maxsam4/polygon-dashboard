# Polygon Dashboard

Real-time Polygon blockchain analytics (gas, finality, MGAS/s, TPS).

## Production

See `prod.md` for server details. **Always confirm with user before deploying.**

## Database Safety

**NEVER drop/truncate tables** - contains months of historical data.

Forbidden:
- `docker compose down -v`
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

Workers: LivePoller (2s), Backfiller, MilestonePoller, MilestoneBackfiller, FinalityReconciler (10s), GapAnalyzer (5m), Gapfiller

Finality: Workers INSERT only, FinalityReconciler matches blocks to milestones via SQL JOIN.

## Key Patterns

- Timestamps: TIMESTAMPTZ
- Block numbers/milestone IDs: BigInt
- Gwei values: DOUBLE PRECISION
- Compressed chunks (>10 days): Cannot efficiently update finality
