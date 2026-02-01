# Polygon Dashboard

A real-time analytics dashboard for monitoring Polygon blockchain metrics including gas prices, finality times, throughput (MGAS/s), and transactions per second (TPS).

**Live Deployment:** [https://polygon-dashboard.mudit.blog](https://polygon-dashboard.mudit.blog)

## Features

- **Real-time Block Monitoring** - Live updates via SSE showing the latest blocks with detailed metrics
- **Gas Price Analytics** - Track base fees and priority fees (min/max/avg/median) in gwei
- **Fee Tracking** - Monitor total base fees and priority fees per block with cumulative graphs showing fee accumulation over time
- **Finality Tracking** - Monitor time-to-finality using Polygon's milestone system via Heimdall API
- **Performance Metrics** - View MGAS/s and TPS with historical charts
- **Historical Analytics** - Interactive charts with configurable time ranges, granularity, and zoom selection
- **Gas Utilization Visualization** - Color-coded progress bars showing gas usage relative to 65% target (green: 55-75%, yellow: off-target, red: extreme)
- **Data Export** - Export block and milestone data in various formats
- **Automatic Data Backfilling** - Background indexers continuously backfill historical block and milestone data
- **Dark/Light Mode** - Theme switching support

## Tech Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **React 18** - UI components
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **lightweight-charts** - TradingView charts for data visualization

### Backend
- **Next.js API Routes** - REST API endpoints
- **TimescaleDB** - Time-series database (PostgreSQL extension)
- **viem** - Ethereum/Polygon RPC client
- **Background Indexers** - Block indexing, backfilling, and milestone tracking

### Infrastructure
- **Docker & Docker Compose** - Containerized deployment
- **Node.js 20** - Runtime environment

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Next.js Application                                 │
├─────────────────┬─────────────────┬──────────────────────────────────────────┤
│   Pages/UI      │   API Routes    │   Background Indexers                    │
│  - Home         │  - /blocks      │   - BlockIndexer (cursor-based, reorg)   │
│  - Analytics    │  - /chart-data  │   - BlockBackfiller (reverse fill)       │
│  - Blocks       │  - /milestones  │   - MilestoneIndexer (direct finality)   │
│  - Milestones   │  - /export      │   - PriorityFeeBackfiller (async fees)   │
│  - Export       │  - /workers     │                                          │
│                 │  - /stream (SSE)│                                          │
└────────┬────────┴────────┬────────┴───────────┬──────────────────────────────┘
         │                 │                    │
         │                 ▼                    │
         │         ┌──────────────┐             │
         │         │  TimescaleDB │◄────────────┘
         │         │   - blocks   │
         │         │   - milestones│
         │         │   - block_finality│
         │         │   - indexer_state│
         │         └──────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         External Services                                     │
│  - Polygon RPC (block data via HTTP/WebSocket)                               │
│  - Heimdall API (finality milestones)                                        │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                         Live-Stream Service                                   │
│  - Standalone Node.js service at /services/live-stream                       │
│  - WebSocket subscriptions to multiple RPC endpoints                         │
│  - SSE endpoint for real-time block streaming                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Indexers

- `BlockIndexer` - Cursor-based forward indexer with reorg detection and recovery
- `BlockBackfiller` - Backwards indexer from lowest block to target
- `MilestoneIndexer` - Cursor-based milestone indexer, writes finality directly
- `PriorityFeeBackfiller` - Async priority fee calculation via transaction receipts

### Database Tables

| Table | Purpose |
|-------|---------|
| `blocks` | Main block data with gas metrics, finality, throughput |
| `milestones` | Polygon finality checkpoints from Heimdall |
| `block_finality` | Dedicated finality records |
| `indexer_state` | Cursor positions for indexers |
| `reorged_blocks` | Reorg tracking |
| `table_stats` | Cached min/max/count for performance |

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Polygon RPC endpoint(s)

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
POLYGON_RPC_URLS=https://polygon.drpc.org,https://polygon-rpc.com,https://polygon-bor-rpc.publicnode.com
DATABASE_URL=postgresql://polygon:polygon@localhost:5432/polygon_dashboard

# Optional
HEIMDALL_API_URLS=https://heimdall-api.polygon.technology,https://polygon-heimdall-rest.publicnode.com
BACKFILL_TO_BLOCK=50000000
BACKFILL_BATCH_SIZE=100
RPC_DELAY_MS=100
```

### Development

1. Start the database:
   ```bash
   docker compose up db -d
   ```

2. Install dependencies and run the development server:
   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000)

### Production Deployment

Deploy the full stack with Docker Compose:

```bash
# Set environment variables
export POLYGON_RPC_URLS=your_rpc_urls
export DB_PASSWORD=secure_password

# Start all services
docker compose up -d
```

The application will be available on port 3000 (configurable via `APP_PORT`).

### Docker Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | polygon | PostgreSQL username |
| `DB_PASSWORD` | polygon | PostgreSQL password |
| `DB_NAME` | polygon_dashboard | Database name |
| `DB_PORT` | 5432 | PostgreSQL port |
| `APP_PORT` | 3000 | Application port |
| `POLYGON_RPC_URLS` | https://polygon.drpc.org,... | Comma-separated RPC endpoints |
| `POLYGON_WS_URLS` | - | WebSocket RPC URLs for live-stream service |
| `HEIMDALL_API_URLS` | https://heimdall-api.polygon.technology,... | Heimdall API endpoints |
| `BACKFILL_TO_BLOCK` | 50000000 | Target block for historical backfill |
| `BACKFILL_BATCH_SIZE` | 100 | Blocks per backfill batch |
| `RPC_DELAY_MS` | 100 | Delay between RPC calls |
| `INDEXER_POLL_MS` | 1000 | Poll interval for indexers |
| `MILESTONE_POLL_MS` | 1000 | Poll interval for milestone indexer |
| `LIVE_STREAM_URL` | http://live-stream:3002 | URL for live-stream service |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/blocks/latest` | Get the most recent blocks with all metrics |
| `GET /api/blocks?page=X&limit=Y` | Get paginated blocks |
| `GET /api/blocks/[blockNumber]` | Get single block details with transactions |
| `GET /api/blocks/stream` | SSE stream for real-time block updates |
| `GET /api/chart-data?fromTime=X&toTime=Y&bucketSize=Z` | Get aggregated chart data with configurable time buckets |
| `GET /api/milestones/latest` | Get the most recent milestones |
| `GET /api/milestones?page=X&limit=Y` | Get paginated milestones |
| `GET /api/milestone-chart-data` | Milestone finality timing data |
| `GET /api/export?type=blocks&format=csv` | Export data in CSV/JSON format |
| `GET /api/workers/start` | Start background workers |
| `GET /api/status` | Worker status (running/idle/stopped) |
| `GET /api/reorgs` | Recent chain reorganizations |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `POLYGON_RPC_URLS` | - | Comma-separated RPC endpoints |
| `POLYGON_WS_URLS` | - | Comma-separated WebSocket RPC endpoints |
| `HEIMDALL_API_URLS` | - | Comma-separated Heimdall endpoints |
| `BACKFILL_TO_BLOCK` | 50000000 | Target block for backfill |
| `BACKFILL_BATCH_SIZE` | 100 | Blocks per backfill batch |
| `RPC_DELAY_MS` | 100 | Delay between RPC calls |
| `INDEXER_POLL_MS` | 1000 | Poll interval for indexers |
| `MILESTONE_POLL_MS` | 1000 | Poll interval for milestone indexer |
| `LIVE_STREAM_URL` | http://live-stream:3002 | URL for live-stream service |
