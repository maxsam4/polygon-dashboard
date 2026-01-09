# Polygon Dashboard - Design Document

**Date:** 2026-01-09
**Status:** Approved
**Author:** Claude + Mudit

---

## Overview

A real-time Polygon blockchain dashboard focused on gas metrics, throughput, and finality tracking. The dashboard provides both live monitoring of the latest blocks and historical analytics with stock-style interactive charts.

---

## Goals

1. Track and visualize gas prices (base fee, priority fees) over time
2. Monitor network throughput (MGAS/s, TPS)
3. Track block finality using Heimdall milestones
4. Provide real-time updates for the latest blocks
5. Enable historical analysis with flexible time ranges and chart types
6. Handle chain reorgs gracefully
7. Support EIP-1559 and pre-EIP-1559 blocks

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js + TypeScript |
| Database | PostgreSQL + TimescaleDB |
| Blockchain RPC | viem |
| Charts | lightweight-charts (TradingView) |
| Styling | Tailwind CSS |
| Deployment | Docker + Docker Compose |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js App                               │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React)              │  Backend (API Routes)          │
│  ─────────────────             │  ──────────────────            │
│  • Real-time Dashboard         │  • /api/blocks/latest          │
│  • Historic Analytics          │  • /api/blocks                 │
│  • Block Explorer              │  • /api/chart-data             │
│  • Dark/Light Toggle           │  • /api/export                 │
└────────────────┬────────────────┴───────────────┬───────────────┘
                 │                                │
                 │      PostgreSQL + TimescaleDB  │
                 │     ┌──────────────────────┐   │
                 └────►│ blocks (hypertable)  │◄──┘
                       │ milestones           │
                       │ metrics_* (caggs)    │
                       └──────────┬───────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
            ▼                     ▼                     ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │  Live Poller    │  │ Milestone Poller│  │   Backfiller    │
   │  (2 sec)        │  │ (2-3 sec)       │  │   (batches)     │
   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
            │                    │                    │
            └────────────────────┴────────────────────┘
                                 │
                                 ▼
                   Polygon RPC + Heimdall API
                   (with fallback endpoints)
```

---

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Real-time dashboard - 4 live graphs (last 20 blocks), latest blocks list |
| `/analytics` | Historic analytics - 4 detailed charts with full controls |
| `/blocks` | Historic blocks list - pagination, jump to block, CSV export |

---

## Metrics Tracked

### 1. Gas Price
- Base fee (gwei)
- Min/Max/Avg priority fee (gwei)
- Total gas price (base + priority)
- OHLC data for candlestick charts

### 2. Finality Delay
- Time from block creation to milestone confirmation
- Tracked via Heimdall milestone API

### 3. MGAS/s (Megagas per second)
- `gas_used / block_time / 1,000,000`
- Network throughput indicator

### 4. TPS (Transactions per second)
- `tx_count / block_time`
- Transaction throughput indicator

---

## Database Schema

### blocks (TimescaleDB Hypertable)

```sql
CREATE TABLE blocks (
  -- Time-based partitioning column first (required by TimescaleDB)
  timestamp TIMESTAMPTZ NOT NULL,
  block_number BIGINT NOT NULL,

  -- Block identity (for reorg detection)
  block_hash CHAR(66) NOT NULL,
  parent_hash CHAR(66) NOT NULL,

  -- Gas metrics
  gas_used BIGINT NOT NULL,
  gas_limit BIGINT NOT NULL,
  base_fee_gwei DOUBLE PRECISION NOT NULL,

  -- Priority fee distribution (gwei)
  min_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  max_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  avg_priority_fee_gwei DOUBLE PRECISION NOT NULL,

  -- Block totals (gwei)
  total_base_fee_gwei DOUBLE PRECISION NOT NULL,
  total_priority_fee_gwei DOUBLE PRECISION NOT NULL,

  -- Throughput metrics
  tx_count INTEGER NOT NULL,
  block_time_sec REAL,
  mgas_per_sec REAL,
  tps REAL,

  -- Finality tracking
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ,
  milestone_id BIGINT,
  time_to_finality_sec REAL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  PRIMARY KEY (timestamp, block_number)
);

-- Hypertable with 7-day chunks
SELECT create_hypertable('blocks', 'timestamp',
  chunk_time_interval => INTERVAL '7 days'
);

-- Indexes
CREATE INDEX idx_blocks_number ON blocks (block_number DESC);
CREATE INDEX idx_blocks_pending ON blocks (block_number) WHERE finalized = FALSE;
CREATE INDEX idx_blocks_hash ON blocks (block_hash);

-- Compression for chunks older than 7 days
ALTER TABLE blocks SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'timestamp DESC, block_number DESC'
);
SELECT add_compression_policy('blocks', INTERVAL '7 days');
```

### milestones

```sql
CREATE TABLE milestones (
  milestone_id BIGINT PRIMARY KEY,
  start_block BIGINT NOT NULL,
  end_block BIGINT NOT NULL,
  hash CHAR(66) NOT NULL,
  proposer CHAR(42),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_milestones_blocks ON milestones (start_block, end_block);
CREATE INDEX idx_milestones_end ON milestones (end_block DESC);
```

### Continuous Aggregates

Pre-computed rollups for efficient chart queries:

| View | Bucket Size | Use Case |
|------|-------------|----------|
| metrics_1m | 1 minute | 1H-6H views |
| metrics_5m | 5 minutes | 6H-1D views |
| metrics_15m | 15 minutes | 1D-1W views |
| metrics_1h | 1 hour | 1W-1M views |
| metrics_4h | 4 hours | 1M-6M views |
| metrics_1d | 1 day | 6M-1Y views |
| metrics_1w | 1 week | ALL time view |

Each aggregate contains:
- Block range (start/end)
- Block count
- Base fee OHLC (open/high/low/close) + avg
- Priority fee (avg/min/max) + OHLC
- Total gas price (avg/min/max)
- MGAS/s and TPS
- Finality delay (avg/min/max)

---

## Background Workers

### Live Poller (every 2 seconds)

```
1. Fetch latest block number from RPC
2. For each new block since last poll:
   a. Fetch block data + transaction details
   b. Calculate gas metrics
   c. Check cached latest milestone - set finalized if covered
   d. Insert into blocks table
3. Reorg handling:
   - Not finalized + hash differs: overwrite
   - Finalized + hash differs: log error, skip, continue
```

### Milestone Poller (every 2-3 seconds)

```
1. Fetch latest milestone from Heimdall API
2. If milestone_id > last stored milestone:
   a. Store new milestone in milestones table
   b. Update blocks in range: set finalized, finalized_at, milestone_id
   c. Calculate time_to_finality_sec for each block
```

### Backfiller (configurable batch size)

```
1. Read BACKFILL_TO_BLOCK, BACKFILL_BATCH_SIZE from .env
2. Find lowest block_number in DB
3. While lowest > BACKFILL_TO_BLOCK:
   a. Fetch batch of BACKFILL_BATCH_SIZE blocks
   b. Calculate gas metrics for each
   c. For finality data:
      - Find milestone covering this block range
      - If milestone not in DB, fetch from Heimdall and store
      - Set finalized, finalized_at, milestone_id
   d. Bulk insert blocks
   e. Delay RPC_DELAY_MS between batches
```

---

## Resilient RPC Client

### Fallback Logic

```typescript
class RpcClient {
  private urls: string[];
  private currentIndex = 0;
  private retryConfig = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
  };

  async call<T>(method: string, params: any[]): Promise<T> {
    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      // Try all endpoints
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await this.makeRequest(this.urls[this.currentIndex], method, params);
        } catch (error) {
          this.currentIndex = (this.currentIndex + 1) % this.urls.length;
        }
      }

      // All endpoints failed, backoff before retry
      if (retry < this.retryConfig.maxRetries) {
        await this.sleep(this.calculateBackoff(retry));
      }
    }

    throw new RpcExhaustedError('All endpoints failed');
  }

  private calculateBackoff(retry: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, retry);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }
}
```

### Backoff Schedule

| Retry | Delay (approx) |
|-------|----------------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| All fail | 5 min pause, restart |

---

## API Routes

### GET /api/blocks/latest

Returns last 20 blocks for live list.

```json
{
  "blocks": [...],
  "latestBlock": 12345680
}
```

### GET /api/blocks

Paginated blocks for historic page.

| Param | Description |
|-------|-------------|
| page | Page number |
| limit | Blocks per page (default 50) |
| fromBlock | Start block number |
| toBlock | End block number |

```json
{
  "blocks": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 2500000,
    "totalPages": 50000
  }
}
```

### GET /api/chart-data

| Param | Description |
|-------|-------------|
| metric | `gas`, `finality`, `mgas`, `tps` |
| fromTime | Start timestamp (unix) |
| toTime | End timestamp (unix) |
| bucketSize | `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w` |
| page | Page number |
| limit | Buckets per page (default 500) |

```json
{
  "metric": "gas",
  "bucketSize": "1m",
  "data": [
    {
      "timestamp": 1704825000,
      "blockStart": 12345600,
      "blockEnd": 12345630,
      "baseFee": { "open": 28, "high": 38, "low": 25, "close": 30, "avg": 30 },
      "priorityFee": { "avg": 2, "min": 0.5, "max": 15, "open": 1.8, "close": 2.1 },
      "total": { "avg": 32, "min": 25.5, "max": 53 }
    }
  ],
  "pagination": { ... }
}
```

### POST /api/export

Generates CSV for block range with selected fields.

```json
{
  "fromBlock": 12300000,
  "toBlock": 12345680,
  "fields": ["block_number", "timestamp", "base_fee_gwei", "avg_priority_fee_gwei", "tx_count"]
}
```

---

## Frontend Components

### Homepage (Real-time Dashboard)

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] Polygon Dashboard            [Dark/Light Toggle]    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐ ┌─────────────────────────┐    │
│  │ Gas Price (gwei)        │ │ Finality Delay (sec)    │    │
│  │ [live graph - 20 blocks]│ │ [live graph - 20 blocks]│    │
│  │ Base: 30 | Avg Pri: 2   │ │ Latest: 4.2s            │    │
│  └─────────────────────────┘ └─────────────────────────┘    │
│  ┌─────────────────────────┐ ┌─────────────────────────┐    │
│  │ MGAS/s                  │ │ TPS                     │    │
│  │ [live graph - 20 blocks]│ │ [live graph - 20 blocks]│    │
│  │ Current: 15.2           │ │ Current: 85             │    │
│  └─────────────────────────┘ └─────────────────────────┘    │
│                                                             │
│  Latest Blocks (live - updates every 2s)                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ #12345680 | 2s ago | 52% | 30 | 2 | 145tx | ✓ 4.2s │ ▼  │
│  │ [expandable: min/max priority, gas used/limit, etc] │    │
│  └─────────────────────────────────────────────────────┘    │
│  [View Analytics →]                  [View All Blocks →]    │
└─────────────────────────────────────────────────────────────┘
```

### Analytics Page

```
┌─────────────────────────────────────────────────────────────┐
│  [← Home] Historic Analytics         [Dark/Light Toggle]    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Gas Price                                           │    │
│  │ [1H][6H][1D][1W][1M][6M][1Y][ALL]  Bucket:[▼ 5m]   │    │
│  │ Chart:[▼ Line]  [x]Base [x]AvgPri [x]Total [ ]Min/Max   │
│  │ [interactive stock-style chart with zoom/pan]       │    │
│  │ Block #12345678-12345690 | Jan 9, 2:30 PM           │    │
│  └─────────────────────────────────────────────────────┘    │
│  [Same layout for: Finality Delay, MGAS/s, TPS]             │
│                                                             │
│  [View Block Details →]              [Export CSV]           │
└─────────────────────────────────────────────────────────────┘
```

**Chart Controls (per chart):**
- Time presets: 1H, 6H, 1D, 1W, 1M, 6M, 1Y, ALL
- Bucket size: 1m, 5m, 15m, 1h, 4h, 1d, 1w
- Chart type: Line, Candle, Area, Bar
- Series toggles (specific to each metric)

### Blocks Page

```
┌─────────────────────────────────────────────────────────────┐
│  [← Home] Historic Blocks            [Dark/Light Toggle]    │
├─────────────────────────────────────────────────────────────┤
│  Jump to Block: [__________] [Go]    [Export CSV]           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Compact: # | time | gas% | base | avgPri | txs | ✓  │ ▼  │
│  ├─────────────────────────────────────────────────────┤    │
│  │ Expanded: min/max priority, gas used/limit,         │    │
│  │ total fees, finality time, [Polygonscan link]       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [← Prev]  Page 1 of 50,000  [Next →]                       │
└─────────────────────────────────────────────────────────────┘
```

### CSV Export Modal

```
┌─────────────────────────────────────┐
│  Export to CSV                      │
├─────────────────────────────────────┤
│  Block Range:                       │
│  From: [________]  To: [________]   │
│                                     │
│  Fields to include:                 │
│  [x] Block Number    [x] Timestamp  │
│  [x] Gas Used %      [x] Base Fee   │
│  [x] Avg Priority    [ ] Min/Max    │
│  [x] Tx Count        [x] Finality   │
│  [ ] Absolute Gas    [ ] Gas Limit  │
│                                     │
│  [Cancel]           [Download CSV]  │
└─────────────────────────────────────┘
```

---

## Project Structure

```
polygon-dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Homepage (real-time dashboard)
│   │   ├── analytics/
│   │   │   └── page.tsx             # Historic analytics
│   │   ├── blocks/
│   │   │   └── page.tsx             # Historic blocks list
│   │   ├── api/
│   │   │   ├── blocks/
│   │   │   │   ├── route.ts         # GET paginated blocks
│   │   │   │   └── latest/
│   │   │   │       └── route.ts     # GET latest 20 blocks
│   │   │   ├── chart-data/
│   │   │   │   └── route.ts         # GET chart aggregations
│   │   │   └── export/
│   │   │       └── route.ts         # POST CSV export
│   │   └── layout.tsx
│   ├── components/
│   │   ├── charts/
│   │   │   ├── GasChart.tsx
│   │   │   ├── FinalityChart.tsx
│   │   │   ├── MgasChart.tsx
│   │   │   ├── TpsChart.tsx
│   │   │   └── ChartControls.tsx
│   │   ├── blocks/
│   │   │   ├── BlockList.tsx
│   │   │   ├── BlockRow.tsx
│   │   │   └── BlockDetails.tsx
│   │   ├── ExportModal.tsx
│   │   └── ThemeToggle.tsx
│   ├── lib/
│   │   ├── db.ts                    # PostgreSQL connection + queries
│   │   ├── rpc.ts                   # Polygon RPC client with fallback
│   │   ├── heimdall.ts              # Heimdall API client with fallback
│   │   └── utils.ts                 # Gas calculations, formatting
│   └── workers/
│       ├── index.ts                 # Worker orchestration
│       ├── livePoller.ts
│       ├── backfiller.ts
│       └── milestonePoller.ts
├── docker/
│   ├── Dockerfile
│   └── init.sql                     # Database schema
├── data/                            # Volume mount for DB
├── docs/
│   └── plans/
│       └── 2026-01-09-polygon-dashboard-design.md
├── docker-compose.yml
├── deploy.sh                        # One-click deploy
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Docker Deployment

### docker-compose.yml

```yaml
version: '3.8'

services:
  db:
    image: timescale/timescaledb-ha:pg16
    restart: always
    environment:
      POSTGRES_USER: ${DB_USER:-polygon}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-polygon}
      POSTGRES_DB: ${DB_NAME:-polygon_dashboard}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "${DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U polygon"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build:
      context: .
      dockerfile: docker/Dockerfile
    restart: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${DB_USER:-polygon}:${DB_PASSWORD:-polygon}@db:5432/${DB_NAME:-polygon_dashboard}
      POLYGON_RPC_URLS: ${POLYGON_RPC_URLS}
      HEIMDALL_API_URLS: ${HEIMDALL_API_URLS:-https://heimdall-api.polygon.technology}
      BACKFILL_TO_BLOCK: ${BACKFILL_TO_BLOCK:-50000000}
      BACKFILL_BATCH_SIZE: ${BACKFILL_BATCH_SIZE:-100}
      RPC_DELAY_MS: ${RPC_DELAY_MS:-100}
      PORT: 3000
    ports:
      - "${APP_PORT:-3000}:3000"

volumes:
  postgres_data:
```

### deploy.sh

```bash
#!/bin/bash
set -e

echo "==================================="
echo "  Polygon Dashboard - Deploy"
echo "==================================="

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "Please edit .env with your configuration:"
    echo "  - POLYGON_RPC_URLS (required)"
    echo "  - APP_PORT (default: 3000)"
    echo "  - DB_PASSWORD (recommended to change)"
    echo "  - BACKFILL_TO_BLOCK (how far back to sync)"
    echo ""
    read -p "Press enter after editing .env to continue..."
fi

set -a
source .env
set +a

if [ -z "$POLYGON_RPC_URLS" ]; then
    echo "Error: POLYGON_RPC_URLS is required in .env"
    exit 1
fi

echo ""
echo "Starting Polygon Dashboard..."
docker compose up -d --build

echo ""
echo "==================================="
echo "  Deployment Complete!"
echo "==================================="
echo ""
echo "  Dashboard: http://localhost:${APP_PORT:-3000}"
echo "  Database:  localhost:${DB_PORT:-5432}"
echo ""
echo "  View logs: docker compose logs -f"
echo "  Stop:      docker compose down"
```

---

## Environment Variables

```bash
# Required - RPC Endpoints (comma-separated, first is primary)
POLYGON_RPC_URLS=https://polygon-rpc.com,https://rpc.ankr.com/polygon,https://polygon.llamarpc.com

# Heimdall API Endpoints (comma-separated, first is primary)
HEIMDALL_API_URLS=https://heimdall-api.polygon.technology,https://heimdall.api.matic.today

# Ports
APP_PORT=3000
DB_PORT=5432

# Database (change password in production!)
DB_USER=polygon
DB_PASSWORD=polygon
DB_NAME=polygon_dashboard

# Backfill Configuration
BACKFILL_TO_BLOCK=50000000
BACKFILL_BATCH_SIZE=100
RPC_DELAY_MS=100
```

---

## EIP-1559 Handling

- **Post EIP-1559**: Base fee from block header, priority fee from transactions
- **Pre EIP-1559**: Base fee = 0, all gas price treated as priority fee
- Detection: Check if `baseFeePerGas` exists in block header

---

## Reorg Handling

1. **Detection**: Compare stored `block_hash` with fetched hash
2. **Non-finalized blocks**: Overwrite with new data
3. **Finalized blocks**: Log error "Data discrepancy detected on block X", skip overwrite, continue processing
4. **Tracking**: `updated_at` timestamp shows when block was last modified

---

## Query Performance

| Query | Method | Performance |
|-------|--------|-------------|
| Latest 20 blocks | Index on block_number | O(1) |
| Block by number | Index on block_number | O(1) |
| Chart 1H @ 1m | metrics_1m continuous aggregate | O(60 rows) |
| Chart 1D @ 5m | metrics_5m continuous aggregate | O(288 rows) |
| Chart 1M @ 1h | metrics_1h continuous aggregate | O(720 rows) |
| Chart 1Y @ 1d | metrics_1d continuous aggregate | O(365 rows) |
| Chart ALL @ 1w | metrics_1w continuous aggregate | O(weeks) |
| Pending blocks | Partial index on finalized=false | O(pending count) |

---

## Storage Estimation

| Component | Size (15M blocks) |
|-----------|-------------------|
| Raw blocks (compressed) | ~450 MB |
| Continuous aggregates | ~50 MB |
| Indexes | ~200 MB |
| **Total** | **~700 MB** |

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^14.x",
    "react": "^18.x",
    "typescript": "^5.x",
    "viem": "^2.x",
    "pg": "^8.x",
    "lightweight-charts": "^4.x",
    "tailwindcss": "^3.x"
  }
}
```

---

## Future Enhancements (Out of Scope)

- Checkpoint finality tracking (in addition to milestones)
- WebSocket for real-time updates (currently polling)
- Multiple chain support
- Alert system for gas price thresholds
- API rate limiting and authentication
