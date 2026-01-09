# Polygon Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real-time Polygon blockchain dashboard with gas metrics, throughput, and finality tracking.

**Architecture:** Next.js full-stack app with PostgreSQL/TimescaleDB for time-series data. Three background workers (live poller, milestone poller, backfiller) feed data. Frontend uses lightweight-charts for stock-style visualizations.

**Tech Stack:** Next.js 14, TypeScript, PostgreSQL + TimescaleDB, viem, lightweight-charts, Tailwind CSS, Docker

---

## Phase 1: Project Setup & Infrastructure

### Task 1.1: Initialize Next.js Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`

**Step 1: Initialize Next.js with TypeScript and Tailwind**

```bash
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

**Step 2: Verify project starts**

Run: `npm run dev`
Expected: Server starts on http://localhost:3000

**Step 3: Commit**

```bash
git add .
git commit -m "feat: initialize Next.js project with TypeScript and Tailwind"
```

---

### Task 1.2: Add Core Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

```bash
npm install viem pg lightweight-charts
npm install -D @types/pg
```

**Step 2: Verify installation**

Run: `npm ls viem pg lightweight-charts`
Expected: Shows installed versions

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add core dependencies (viem, pg, lightweight-charts)"
```

---

### Task 1.3: Create Environment Configuration

**Files:**
- Create: `.env.example`
- Create: `.env.local`
- Create: `src/lib/env.ts`

**Step 1: Create .env.example**

```bash
# .env.example
# Required - RPC Endpoints (comma-separated, first is primary)
POLYGON_RPC_URLS=https://polygon-rpc.com,https://rpc.ankr.com/polygon

# Heimdall API Endpoints (comma-separated, first is primary)
HEIMDALL_API_URLS=https://heimdall-api.polygon.technology

# Ports
APP_PORT=3000
DB_PORT=5432

# Database
DB_USER=polygon
DB_PASSWORD=polygon
DB_NAME=polygon_dashboard
DATABASE_URL=postgresql://polygon:polygon@localhost:5432/polygon_dashboard

# Backfill Configuration
BACKFILL_TO_BLOCK=50000000
BACKFILL_BATCH_SIZE=100
RPC_DELAY_MS=100
```

**Step 2: Create environment validation**

```typescript
// src/lib/env.ts
function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvVarList(name: string, defaultValue?: string): string[] {
  const value = getEnvVar(name, defaultValue);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function getEnvVarInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
}

export const env = {
  polygonRpcUrls: getEnvVarList('POLYGON_RPC_URLS'),
  heimdallApiUrls: getEnvVarList('HEIMDALL_API_URLS', 'https://heimdall-api.polygon.technology'),
  databaseUrl: getEnvVar('DATABASE_URL'),
  backfillToBlock: getEnvVarInt('BACKFILL_TO_BLOCK', 50000000),
  backfillBatchSize: getEnvVarInt('BACKFILL_BATCH_SIZE', 100),
  rpcDelayMs: getEnvVarInt('RPC_DELAY_MS', 100),
} as const;
```

**Step 3: Copy to .env.local for development**

```bash
cp .env.example .env.local
```

**Step 4: Commit**

```bash
git add .env.example src/lib/env.ts
git commit -m "feat: add environment configuration with validation"
```

---

### Task 1.4: Create Docker Infrastructure

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/init.sql`
- Create: `docker-compose.yml`
- Create: `deploy.sh`
- Create: `.dockerignore`

**Step 1: Create Dockerfile**

```dockerfile
# docker/Dockerfile
FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
```

**Step 2: Create database init script**

```sql
-- docker/init.sql
-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Blocks table
CREATE TABLE blocks (
  timestamp TIMESTAMPTZ NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash CHAR(66) NOT NULL,
  parent_hash CHAR(66) NOT NULL,
  gas_used BIGINT NOT NULL,
  gas_limit BIGINT NOT NULL,
  base_fee_gwei DOUBLE PRECISION NOT NULL,
  min_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  max_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  avg_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  total_base_fee_gwei DOUBLE PRECISION NOT NULL,
  total_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  tx_count INTEGER NOT NULL,
  block_time_sec REAL,
  mgas_per_sec REAL,
  tps REAL,
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ,
  milestone_id BIGINT,
  time_to_finality_sec REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (timestamp, block_number)
);

SELECT create_hypertable('blocks', 'timestamp', chunk_time_interval => INTERVAL '7 days');

CREATE INDEX idx_blocks_number ON blocks (block_number DESC);
CREATE INDEX idx_blocks_pending ON blocks (block_number) WHERE finalized = FALSE;
CREATE INDEX idx_blocks_hash ON blocks (block_hash);

ALTER TABLE blocks SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'timestamp DESC, block_number DESC'
);
SELECT add_compression_policy('blocks', INTERVAL '7 days');

-- Milestones table
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

**Step 3: Create docker-compose.yml**

```yaml
# docker-compose.yml
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

**Step 4: Create deploy script**

```bash
#!/bin/bash
# deploy.sh
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

**Step 5: Create .dockerignore**

```
# .dockerignore
node_modules
.next
.git
.env*
!.env.example
*.md
.DS_Store
```

**Step 6: Make deploy.sh executable**

```bash
chmod +x deploy.sh
```

**Step 7: Update next.config.js for standalone output**

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

module.exports = nextConfig
```

**Step 8: Commit**

```bash
git add docker/ docker-compose.yml deploy.sh .dockerignore next.config.js
git commit -m "feat: add Docker infrastructure with TimescaleDB"
```

---

### Task 1.5: Create Database Connection

**Files:**
- Create: `src/lib/db.ts`

**Step 1: Create database client**

```typescript
// src/lib/db.ts
import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add PostgreSQL database connection pool"
```

---

## Phase 2: Core Library - RPC & Heimdall Clients

### Task 2.1: Create Resilient RPC Client

**Files:**
- Create: `src/lib/rpc.ts`
- Create: `src/lib/types.ts`

**Step 1: Create types**

```typescript
// src/lib/types.ts
export interface Block {
  blockNumber: bigint;
  timestamp: Date;
  blockHash: string;
  parentHash: string;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  avgPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  txCount: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  finalizedAt: Date | null;
  milestoneId: bigint | null;
  timeToFinalitySec: number | null;
}

export interface Milestone {
  milestoneId: bigint;
  startBlock: bigint;
  endBlock: bigint;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

export interface BlockRow {
  timestamp: Date;
  block_number: string;
  block_hash: string;
  parent_hash: string;
  gas_used: string;
  gas_limit: string;
  base_fee_gwei: number;
  min_priority_fee_gwei: number;
  max_priority_fee_gwei: number;
  avg_priority_fee_gwei: number;
  total_base_fee_gwei: number;
  total_priority_fee_gwei: number;
  tx_count: number;
  block_time_sec: number | null;
  mgas_per_sec: number | null;
  tps: number | null;
  finalized: boolean;
  finalized_at: Date | null;
  milestone_id: string | null;
  time_to_finality_sec: number | null;
}

export interface ChartDataPoint {
  timestamp: number;
  blockStart: number;
  blockEnd: number;
  baseFee: { open: number; high: number; low: number; close: number; avg: number };
  priorityFee: { avg: number; min: number; max: number; open: number; close: number };
  total: { avg: number; min: number; max: number };
  mgasPerSec: number;
  tps: number;
  finalityAvg: number | null;
  finalityMin: number | null;
  finalityMax: number | null;
}
```

**Step 2: Create RPC client**

```typescript
// src/lib/rpc.ts
import { createPublicClient, http, PublicClient, Block as ViemBlock, Transaction } from 'viem';
import { polygon } from 'viem/chains';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

export class RpcExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'RpcExhaustedError';
  }
}

export class RpcClient {
  private urls: string[];
  private clients: PublicClient[];
  private currentIndex = 0;
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one RPC URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: polygon,
        transport: http(url),
      })
    );
  }

  private get client(): PublicClient {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
  }

  private calculateBackoff(retry: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, retry);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await fn(this.client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`RPC ${this.urls[this.currentIndex]} failed: ${lastError.message}`);
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        const delay = this.calculateBackoff(retry);
        console.warn(`All endpoints failed. Retry ${retry + 1}/${this.retryConfig.maxRetries} in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new RpcExhaustedError(
      `All RPC endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber());
  }

  async getBlock(blockNumber: bigint): Promise<ViemBlock> {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: false })
    );
  }

  async getBlockWithTransactions(blockNumber: bigint): Promise<ViemBlock<bigint, boolean, Transaction>> {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: true })
    ) as Promise<ViemBlock<bigint, boolean, Transaction>>;
  }
}

let rpcClient: RpcClient | null = null;

export function getRpcClient(): RpcClient {
  if (!rpcClient) {
    const urls = process.env.POLYGON_RPC_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!urls || urls.length === 0) {
      throw new Error('POLYGON_RPC_URLS environment variable is required');
    }
    rpcClient = new RpcClient(urls);
  }
  return rpcClient;
}
```

**Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/rpc.ts
git commit -m "feat: add resilient RPC client with fallback and retry"
```

---

### Task 2.2: Create Heimdall API Client

**Files:**
- Create: `src/lib/heimdall.ts`

**Step 1: Create Heimdall client**

```typescript
// src/lib/heimdall.ts
import { Milestone } from './types';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

interface HeimdallMilestoneResponse {
  result: {
    id: number;
    start_block: number;
    end_block: number;
    hash: string;
    proposer: string;
    bor_chain_id: string;
    timestamp: number;
  };
}

interface HeimdallCountResponse {
  result: {
    count: number;
  };
}

export class HeimdallExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'HeimdallExhaustedError';
  }
}

export class HeimdallClient {
  private urls: string[];
  private currentIndex = 0;
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one Heimdall API URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
  }

  private get baseUrl(): string {
    return this.urls[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
  }

  private calculateBackoff(retry: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, retry);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetch<T>(path: string): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          const url = `${this.baseUrl}${path}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return (await response.json()) as T;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Heimdall ${this.baseUrl} failed: ${lastError.message}`);
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        const delay = this.calculateBackoff(retry);
        console.warn(`All Heimdall endpoints failed. Retry ${retry + 1}/${this.retryConfig.maxRetries} in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new HeimdallExhaustedError(
      `All Heimdall endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getLatestMilestone(): Promise<Milestone> {
    const response = await this.fetch<HeimdallMilestoneResponse>('/milestone/latest');
    return this.parseMilestone(response);
  }

  async getMilestone(id: number): Promise<Milestone> {
    const response = await this.fetch<HeimdallMilestoneResponse>(`/milestone/${id}`);
    return this.parseMilestone(response);
  }

  async getMilestoneCount(): Promise<number> {
    const response = await this.fetch<HeimdallCountResponse>('/milestone/count');
    return response.result.count;
  }

  private parseMilestone(response: HeimdallMilestoneResponse): Milestone {
    const r = response.result;
    return {
      milestoneId: BigInt(r.id),
      startBlock: BigInt(r.start_block),
      endBlock: BigInt(r.end_block),
      hash: r.hash,
      proposer: r.proposer || null,
      timestamp: new Date(r.timestamp * 1000),
    };
  }
}

let heimdallClient: HeimdallClient | null = null;

export function getHeimdallClient(): HeimdallClient {
  if (!heimdallClient) {
    const urls = process.env.HEIMDALL_API_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!urls || urls.length === 0) {
      heimdallClient = new HeimdallClient(['https://heimdall-api.polygon.technology']);
    } else {
      heimdallClient = new HeimdallClient(urls);
    }
  }
  return heimdallClient;
}
```

**Step 2: Commit**

```bash
git add src/lib/heimdall.ts
git commit -m "feat: add Heimdall API client with fallback and retry"
```

---

### Task 2.3: Create Gas Calculation Utilities

**Files:**
- Create: `src/lib/gas.ts`

**Step 1: Create gas utilities**

```typescript
// src/lib/gas.ts
import { Block as ViemBlock, Transaction } from 'viem';

const GWEI = 1_000_000_000n;

export function weiToGwei(wei: bigint): number {
  return Number(wei) / Number(GWEI);
}

export function calculateBlockMetrics(
  block: ViemBlock<bigint, boolean, Transaction>,
  previousBlockTimestamp?: bigint
): {
  baseFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  avgPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
} {
  const baseFeePerGas = block.baseFeePerGas ?? 0n;
  const baseFeeGwei = weiToGwei(baseFeePerGas);
  const gasUsed = block.gasUsed;
  const txCount = block.transactions.length;

  // Calculate priority fees from transactions
  let minPriorityFee = BigInt(Number.MAX_SAFE_INTEGER);
  let maxPriorityFee = 0n;
  let totalPriorityFee = 0n;

  const transactions = block.transactions as Transaction[];

  if (transactions.length === 0) {
    minPriorityFee = 0n;
  } else {
    for (const tx of transactions) {
      let priorityFee: bigint;

      if (tx.maxPriorityFeePerGas !== undefined && tx.maxPriorityFeePerGas !== null) {
        // EIP-1559 transaction
        priorityFee = tx.maxPriorityFeePerGas;
      } else if (tx.gasPrice !== undefined && tx.gasPrice !== null) {
        // Legacy transaction - priority fee is gasPrice - baseFee
        priorityFee = baseFeePerGas > 0n
          ? (tx.gasPrice > baseFeePerGas ? tx.gasPrice - baseFeePerGas : 0n)
          : tx.gasPrice; // Pre-EIP-1559: all is priority fee
      } else {
        priorityFee = 0n;
      }

      if (priorityFee < minPriorityFee) minPriorityFee = priorityFee;
      if (priorityFee > maxPriorityFee) maxPriorityFee = priorityFee;
      totalPriorityFee += priorityFee * (tx.gas ?? 0n);
    }
  }

  const avgPriorityFee = txCount > 0
    ? totalPriorityFee / BigInt(txCount) / (gasUsed > 0n ? gasUsed / BigInt(txCount) : 1n)
    : 0n;

  // Calculate totals
  const totalBaseFeeGwei = weiToGwei(baseFeePerGas * gasUsed);
  const totalPriorityFeeGwei = weiToGwei(totalPriorityFee);

  // Calculate throughput metrics
  let blockTimeSec: number | null = null;
  let mgasPerSec: number | null = null;
  let tps: number | null = null;

  if (previousBlockTimestamp !== undefined) {
    blockTimeSec = Number(block.timestamp - previousBlockTimestamp);
    if (blockTimeSec > 0) {
      mgasPerSec = Number(gasUsed) / blockTimeSec / 1_000_000;
      tps = txCount / blockTimeSec;
    }
  }

  return {
    baseFeeGwei,
    minPriorityFeeGwei: weiToGwei(minPriorityFee),
    maxPriorityFeeGwei: weiToGwei(maxPriorityFee),
    avgPriorityFeeGwei: weiToGwei(avgPriorityFee),
    totalBaseFeeGwei,
    totalPriorityFeeGwei,
    blockTimeSec,
    mgasPerSec,
    tps,
  };
}

export function formatGwei(gwei: number): string {
  if (gwei < 0.01) return gwei.toFixed(4);
  if (gwei < 1) return gwei.toFixed(3);
  if (gwei < 100) return gwei.toFixed(2);
  return gwei.toFixed(1);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}
```

**Step 2: Commit**

```bash
git add src/lib/gas.ts
git commit -m "feat: add gas calculation utilities"
```

---

## Phase 3: Database Queries

### Task 3.1: Create Block Database Queries

**Files:**
- Create: `src/lib/queries/blocks.ts`

**Step 1: Create block queries**

```typescript
// src/lib/queries/blocks.ts
import { query, queryOne, getPool } from '../db';
import { Block, BlockRow } from '../types';

function rowToBlock(row: BlockRow): Block {
  return {
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    blockHash: row.block_hash,
    parentHash: row.parent_hash,
    gasUsed: BigInt(row.gas_used),
    gasLimit: BigInt(row.gas_limit),
    baseFeeGwei: row.base_fee_gwei,
    minPriorityFeeGwei: row.min_priority_fee_gwei,
    maxPriorityFeeGwei: row.max_priority_fee_gwei,
    avgPriorityFeeGwei: row.avg_priority_fee_gwei,
    totalBaseFeeGwei: row.total_base_fee_gwei,
    totalPriorityFeeGwei: row.total_priority_fee_gwei,
    txCount: row.tx_count,
    blockTimeSec: row.block_time_sec,
    mgasPerSec: row.mgas_per_sec,
    tps: row.tps,
    finalized: row.finalized,
    finalizedAt: row.finalized_at,
    milestoneId: row.milestone_id ? BigInt(row.milestone_id) : null,
    timeToFinalitySec: row.time_to_finality_sec,
  };
}

export async function getLatestBlocks(limit = 20): Promise<Block[]> {
  const rows = await query<BlockRow>(
    `SELECT * FROM blocks ORDER BY block_number DESC LIMIT $1`,
    [limit]
  );
  return rows.map(rowToBlock);
}

export async function getBlockByNumber(blockNumber: bigint): Promise<Block | null> {
  const row = await queryOne<BlockRow>(
    `SELECT * FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );
  return row ? rowToBlock(row) : null;
}

export async function getBlocksPaginated(
  page: number,
  limit: number,
  fromBlock?: bigint,
  toBlock?: bigint
): Promise<{ blocks: Block[]; total: number }> {
  const offset = (page - 1) * limit;
  let whereClause = '';
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (fromBlock !== undefined) {
    whereClause += ` AND block_number >= $${paramIndex++}`;
    params.push(fromBlock.toString());
  }
  if (toBlock !== undefined) {
    whereClause += ` AND block_number <= $${paramIndex++}`;
    params.push(toBlock.toString());
  }

  const countQuery = `SELECT COUNT(*) as count FROM blocks WHERE 1=1 ${whereClause}`;
  const countResult = await queryOne<{ count: string }>(countQuery, params);
  const total = parseInt(countResult?.count ?? '0', 10);

  const dataQuery = `
    SELECT * FROM blocks
    WHERE 1=1 ${whereClause}
    ORDER BY block_number DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;
  const rows = await query<BlockRow>(dataQuery, [...params, limit, offset]);

  return {
    blocks: rows.map(rowToBlock),
    total,
  };
}

export async function getLowestBlockNumber(): Promise<bigint | null> {
  const row = await queryOne<{ min: string }>(`SELECT MIN(block_number) as min FROM blocks`);
  return row?.min ? BigInt(row.min) : null;
}

export async function getHighestBlockNumber(): Promise<bigint | null> {
  const row = await queryOne<{ max: string }>(`SELECT MAX(block_number) as max FROM blocks`);
  return row?.max ? BigInt(row.max) : null;
}

export async function insertBlock(block: Omit<Block, 'createdAt' | 'updatedAt'>): Promise<void> {
  await query(
    `INSERT INTO blocks (
      timestamp, block_number, block_hash, parent_hash,
      gas_used, gas_limit, base_fee_gwei,
      min_priority_fee_gwei, max_priority_fee_gwei, avg_priority_fee_gwei,
      total_base_fee_gwei, total_priority_fee_gwei,
      tx_count, block_time_sec, mgas_per_sec, tps,
      finalized, finalized_at, milestone_id, time_to_finality_sec
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (timestamp, block_number) DO UPDATE SET
      block_hash = EXCLUDED.block_hash,
      parent_hash = EXCLUDED.parent_hash,
      gas_used = EXCLUDED.gas_used,
      gas_limit = EXCLUDED.gas_limit,
      base_fee_gwei = EXCLUDED.base_fee_gwei,
      min_priority_fee_gwei = EXCLUDED.min_priority_fee_gwei,
      max_priority_fee_gwei = EXCLUDED.max_priority_fee_gwei,
      avg_priority_fee_gwei = EXCLUDED.avg_priority_fee_gwei,
      total_base_fee_gwei = EXCLUDED.total_base_fee_gwei,
      total_priority_fee_gwei = EXCLUDED.total_priority_fee_gwei,
      tx_count = EXCLUDED.tx_count,
      block_time_sec = EXCLUDED.block_time_sec,
      mgas_per_sec = EXCLUDED.mgas_per_sec,
      tps = EXCLUDED.tps,
      updated_at = NOW()
    WHERE blocks.finalized = FALSE`,
    [
      block.timestamp,
      block.blockNumber.toString(),
      block.blockHash,
      block.parentHash,
      block.gasUsed.toString(),
      block.gasLimit.toString(),
      block.baseFeeGwei,
      block.minPriorityFeeGwei,
      block.maxPriorityFeeGwei,
      block.avgPriorityFeeGwei,
      block.totalBaseFeeGwei,
      block.totalPriorityFeeGwei,
      block.txCount,
      block.blockTimeSec,
      block.mgasPerSec,
      block.tps,
      block.finalized,
      block.finalizedAt,
      block.milestoneId?.toString() ?? null,
      block.timeToFinalitySec,
    ]
  );
}

export async function insertBlocksBatch(blocks: Omit<Block, 'createdAt' | 'updatedAt'>[]): Promise<void> {
  if (blocks.length === 0) return;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const block of blocks) {
      await client.query(
        `INSERT INTO blocks (
          timestamp, block_number, block_hash, parent_hash,
          gas_used, gas_limit, base_fee_gwei,
          min_priority_fee_gwei, max_priority_fee_gwei, avg_priority_fee_gwei,
          total_base_fee_gwei, total_priority_fee_gwei,
          tx_count, block_time_sec, mgas_per_sec, tps,
          finalized, finalized_at, milestone_id, time_to_finality_sec
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (timestamp, block_number) DO NOTHING`,
        [
          block.timestamp,
          block.blockNumber.toString(),
          block.blockHash,
          block.parentHash,
          block.gasUsed.toString(),
          block.gasLimit.toString(),
          block.baseFeeGwei,
          block.minPriorityFeeGwei,
          block.maxPriorityFeeGwei,
          block.avgPriorityFeeGwei,
          block.totalBaseFeeGwei,
          block.totalPriorityFeeGwei,
          block.txCount,
          block.blockTimeSec,
          block.mgasPerSec,
          block.tps,
          block.finalized,
          block.finalizedAt,
          block.milestoneId?.toString() ?? null,
          block.timeToFinalitySec,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateBlockFinality(
  blockNumber: bigint,
  milestoneId: bigint,
  finalizedAt: Date
): Promise<void> {
  const timeToFinality = await queryOne<{ block_timestamp: Date }>(
    `SELECT timestamp as block_timestamp FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );

  const timeToFinalitySec = timeToFinality
    ? (finalizedAt.getTime() - timeToFinality.block_timestamp.getTime()) / 1000
    : null;

  await query(
    `UPDATE blocks SET
      finalized = TRUE,
      finalized_at = $1,
      milestone_id = $2,
      time_to_finality_sec = $3,
      updated_at = NOW()
    WHERE block_number = $4 AND finalized = FALSE`,
    [finalizedAt, milestoneId.toString(), timeToFinalitySec, blockNumber.toString()]
  );
}

export async function updateBlocksFinalityInRange(
  startBlock: bigint,
  endBlock: bigint,
  milestoneId: bigint,
  finalizedAt: Date
): Promise<number> {
  const result = await query<{ block_number: string; timestamp: Date }>(
    `SELECT block_number, timestamp FROM blocks
     WHERE block_number >= $1 AND block_number <= $2 AND finalized = FALSE`,
    [startBlock.toString(), endBlock.toString()]
  );

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const row of result) {
      const timeToFinalitySec = (finalizedAt.getTime() - row.timestamp.getTime()) / 1000;
      await client.query(
        `UPDATE blocks SET
          finalized = TRUE,
          finalized_at = $1,
          milestone_id = $2,
          time_to_finality_sec = $3,
          updated_at = NOW()
        WHERE block_number = $4`,
        [finalizedAt, milestoneId.toString(), timeToFinalitySec, row.block_number]
      );
    }

    await client.query('COMMIT');
    return result.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/queries/blocks.ts
git commit -m "feat: add block database queries"
```

---

### Task 3.2: Create Milestone Database Queries

**Files:**
- Create: `src/lib/queries/milestones.ts`

**Step 1: Create milestone queries**

```typescript
// src/lib/queries/milestones.ts
import { query, queryOne } from '../db';
import { Milestone } from '../types';

interface MilestoneRow {
  milestone_id: string;
  start_block: string;
  end_block: string;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

function rowToMilestone(row: MilestoneRow): Milestone {
  return {
    milestoneId: BigInt(row.milestone_id),
    startBlock: BigInt(row.start_block),
    endBlock: BigInt(row.end_block),
    hash: row.hash,
    proposer: row.proposer,
    timestamp: row.timestamp,
  };
}

export async function getLatestMilestone(): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones ORDER BY milestone_id DESC LIMIT 1`
  );
  return row ? rowToMilestone(row) : null;
}

export async function getMilestoneById(id: bigint): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones WHERE milestone_id = $1`,
    [id.toString()]
  );
  return row ? rowToMilestone(row) : null;
}

export async function getMilestoneForBlock(blockNumber: bigint): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones
     WHERE start_block <= $1 AND end_block >= $1
     ORDER BY milestone_id DESC LIMIT 1`,
    [blockNumber.toString()]
  );
  return row ? rowToMilestone(row) : null;
}

export async function insertMilestone(milestone: Milestone): Promise<void> {
  await query(
    `INSERT INTO milestones (milestone_id, start_block, end_block, hash, proposer, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (milestone_id) DO NOTHING`,
    [
      milestone.milestoneId.toString(),
      milestone.startBlock.toString(),
      milestone.endBlock.toString(),
      milestone.hash,
      milestone.proposer,
      milestone.timestamp,
    ]
  );
}

export async function getLowestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ min: string }>(`SELECT MIN(milestone_id) as min FROM milestones`);
  return row?.min ? BigInt(row.min) : null;
}

export async function getHighestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ max: string }>(`SELECT MAX(milestone_id) as max FROM milestones`);
  return row?.max ? BigInt(row.max) : null;
}
```

**Step 2: Commit**

```bash
git add src/lib/queries/milestones.ts
git commit -m "feat: add milestone database queries"
```

---

### Task 3.3: Create Chart Data Queries

**Files:**
- Create: `src/lib/queries/charts.ts`

**Step 1: Create chart queries**

```typescript
// src/lib/queries/charts.ts
import { query } from '../db';
import { ChartDataPoint } from '../types';

type BucketSize = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

const BUCKET_INTERVALS: Record<BucketSize, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '1 day',
  '1w': '1 week',
};

interface ChartRow {
  bucket: Date;
  block_start: string;
  block_end: string;
  block_count: string;
  base_fee_open: number;
  base_fee_high: number;
  base_fee_low: number;
  base_fee_close: number;
  base_fee_avg: number;
  priority_fee_avg: number;
  priority_fee_min: number;
  priority_fee_max: number;
  priority_fee_open: number;
  priority_fee_close: number;
  total_gas_price_avg: number;
  total_gas_price_min: number;
  total_gas_price_max: number;
  mgas_per_sec: number;
  tps: number;
  finality_avg: number | null;
  finality_min: number | null;
  finality_max: number | null;
}

export async function getChartData(
  fromTime: Date,
  toTime: Date,
  bucketSize: BucketSize,
  page = 1,
  limit = 500
): Promise<{ data: ChartDataPoint[]; total: number }> {
  const interval = BUCKET_INTERVALS[bucketSize];
  const offset = (page - 1) * limit;

  // Count total buckets
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT time_bucket($1::interval, timestamp)) as count
     FROM blocks
     WHERE timestamp >= $2 AND timestamp <= $3`,
    [interval, fromTime, toTime]
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  // Get aggregated data
  const rows = await query<ChartRow>(
    `SELECT
      time_bucket($1::interval, timestamp) AS bucket,
      MIN(block_number) AS block_start,
      MAX(block_number) AS block_end,
      COUNT(*) AS block_count,

      (array_agg(base_fee_gwei ORDER BY timestamp))[1] AS base_fee_open,
      MAX(base_fee_gwei) AS base_fee_high,
      MIN(base_fee_gwei) AS base_fee_low,
      (array_agg(base_fee_gwei ORDER BY timestamp DESC))[1] AS base_fee_close,
      AVG(base_fee_gwei) AS base_fee_avg,

      AVG(avg_priority_fee_gwei) AS priority_fee_avg,
      MIN(min_priority_fee_gwei) AS priority_fee_min,
      MAX(max_priority_fee_gwei) AS priority_fee_max,
      (array_agg(avg_priority_fee_gwei ORDER BY timestamp))[1] AS priority_fee_open,
      (array_agg(avg_priority_fee_gwei ORDER BY timestamp DESC))[1] AS priority_fee_close,

      AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
      MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
      MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,

      SUM(gas_used)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) / 1000000 AS mgas_per_sec,
      SUM(tx_count)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) AS tps,

      AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
      MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
      MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max

    FROM blocks
    WHERE timestamp >= $2 AND timestamp <= $3
    GROUP BY bucket
    ORDER BY bucket
    LIMIT $4 OFFSET $5`,
    [interval, fromTime, toTime, limit, offset]
  );

  const data: ChartDataPoint[] = rows.map((row) => ({
    timestamp: row.bucket.getTime() / 1000,
    blockStart: parseInt(row.block_start, 10),
    blockEnd: parseInt(row.block_end, 10),
    baseFee: {
      open: row.base_fee_open,
      high: row.base_fee_high,
      low: row.base_fee_low,
      close: row.base_fee_close,
      avg: row.base_fee_avg,
    },
    priorityFee: {
      avg: row.priority_fee_avg,
      min: row.priority_fee_min,
      max: row.priority_fee_max,
      open: row.priority_fee_open,
      close: row.priority_fee_close,
    },
    total: {
      avg: row.total_gas_price_avg,
      min: row.total_gas_price_min,
      max: row.total_gas_price_max,
    },
    mgasPerSec: row.mgas_per_sec ?? 0,
    tps: row.tps ?? 0,
    finalityAvg: row.finality_avg,
    finalityMin: row.finality_min,
    finalityMax: row.finality_max,
  }));

  return { data, total };
}
```

**Step 2: Commit**

```bash
git add src/lib/queries/charts.ts
git commit -m "feat: add chart data aggregation queries"
```

---

### Task 3.4: Create Query Index

**Files:**
- Create: `src/lib/queries/index.ts`

**Step 1: Create index file**

```typescript
// src/lib/queries/index.ts
export * from './blocks';
export * from './milestones';
export * from './charts';
```

**Step 2: Commit**

```bash
git add src/lib/queries/index.ts
git commit -m "feat: add queries index"
```

---

## Phase 4: API Routes

### Task 4.1: Create Latest Blocks API

**Files:**
- Create: `src/app/api/blocks/latest/route.ts`

**Step 1: Create API route**

```typescript
// src/app/api/blocks/latest/route.ts
import { NextResponse } from 'next/server';
import { getLatestBlocks, getHighestBlockNumber } from '@/lib/queries';

export async function GET() {
  try {
    const [blocks, latestBlockNumber] = await Promise.all([
      getLatestBlocks(20),
      getHighestBlockNumber(),
    ]);

    const response = {
      blocks: blocks.map((block) => ({
        blockNumber: block.blockNumber.toString(),
        timestamp: block.timestamp.toISOString(),
        blockHash: block.blockHash,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        gasUsedPercent: Number(block.gasUsed * 100n / block.gasLimit),
        baseFeeGwei: block.baseFeeGwei,
        avgPriorityFeeGwei: block.avgPriorityFeeGwei,
        minPriorityFeeGwei: block.minPriorityFeeGwei,
        maxPriorityFeeGwei: block.maxPriorityFeeGwei,
        txCount: block.txCount,
        blockTimeSec: block.blockTimeSec,
        mgasPerSec: block.mgasPerSec,
        tps: block.tps,
        finalized: block.finalized,
        timeToFinalitySec: block.timeToFinalitySec,
      })),
      latestBlock: latestBlockNumber?.toString() ?? null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching latest blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch latest blocks' },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/blocks/latest/route.ts
git commit -m "feat: add latest blocks API endpoint"
```

---

### Task 4.2: Create Paginated Blocks API

**Files:**
- Create: `src/app/api/blocks/route.ts`

**Step 1: Create API route**

```typescript
// src/app/api/blocks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getBlocksPaginated } from '@/lib/queries';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const fromBlock = searchParams.get('fromBlock');
    const toBlock = searchParams.get('toBlock');

    const { blocks, total } = await getBlocksPaginated(
      page,
      limit,
      fromBlock ? BigInt(fromBlock) : undefined,
      toBlock ? BigInt(toBlock) : undefined
    );

    const response = {
      blocks: blocks.map((block) => ({
        blockNumber: block.blockNumber.toString(),
        timestamp: block.timestamp.toISOString(),
        blockHash: block.blockHash,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        gasUsedPercent: Number(block.gasUsed * 100n / block.gasLimit),
        baseFeeGwei: block.baseFeeGwei,
        avgPriorityFeeGwei: block.avgPriorityFeeGwei,
        minPriorityFeeGwei: block.minPriorityFeeGwei,
        maxPriorityFeeGwei: block.maxPriorityFeeGwei,
        totalBaseFeeGwei: block.totalBaseFeeGwei,
        totalPriorityFeeGwei: block.totalPriorityFeeGwei,
        txCount: block.txCount,
        blockTimeSec: block.blockTimeSec,
        mgasPerSec: block.mgasPerSec,
        tps: block.tps,
        finalized: block.finalized,
        finalizedAt: block.finalizedAt?.toISOString() ?? null,
        timeToFinalitySec: block.timeToFinalitySec,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocks' },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat: add paginated blocks API endpoint"
```

---

### Task 4.3: Create Chart Data API

**Files:**
- Create: `src/app/api/chart-data/route.ts`

**Step 1: Create API route**

```typescript
// src/app/api/chart-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getChartData } from '@/lib/queries';

const VALID_BUCKET_SIZES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
type BucketSize = (typeof VALID_BUCKET_SIZES)[number];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fromTime = searchParams.get('fromTime');
    const toTime = searchParams.get('toTime');
    const bucketSize = searchParams.get('bucketSize') as BucketSize;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 1000);

    if (!fromTime || !toTime) {
      return NextResponse.json(
        { error: 'fromTime and toTime are required' },
        { status: 400 }
      );
    }

    if (!VALID_BUCKET_SIZES.includes(bucketSize)) {
      return NextResponse.json(
        { error: `bucketSize must be one of: ${VALID_BUCKET_SIZES.join(', ')}` },
        { status: 400 }
      );
    }

    const fromDate = new Date(parseInt(fromTime, 10) * 1000);
    const toDate = new Date(parseInt(toTime, 10) * 1000);

    const { data, total } = await getChartData(fromDate, toDate, bucketSize, page, limit);

    return NextResponse.json({
      bucketSize,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/chart-data/route.ts
git commit -m "feat: add chart data API endpoint"
```

---

### Task 4.4: Create CSV Export API

**Files:**
- Create: `src/app/api/export/route.ts`

**Step 1: Create API route**

```typescript
// src/app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getBlocksPaginated } from '@/lib/queries';

const ALL_FIELDS = [
  'block_number',
  'timestamp',
  'gas_used',
  'gas_limit',
  'gas_used_percent',
  'base_fee_gwei',
  'avg_priority_fee_gwei',
  'min_priority_fee_gwei',
  'max_priority_fee_gwei',
  'total_base_fee_gwei',
  'total_priority_fee_gwei',
  'tx_count',
  'block_time_sec',
  'mgas_per_sec',
  'tps',
  'finalized',
  'time_to_finality_sec',
] as const;

type ExportField = (typeof ALL_FIELDS)[number];

interface ExportRequest {
  fromBlock: string;
  toBlock: string;
  fields: ExportField[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExportRequest;
    const { fromBlock, toBlock, fields } = body;

    if (!fromBlock || !toBlock) {
      return NextResponse.json(
        { error: 'fromBlock and toBlock are required' },
        { status: 400 }
      );
    }

    const validFields = fields.filter((f) => ALL_FIELDS.includes(f));
    if (validFields.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid field is required' },
        { status: 400 }
      );
    }

    // Fetch all blocks in range (paginated internally)
    const allBlocks: Record<string, unknown>[] = [];
    let page = 1;
    const limit = 1000;

    while (true) {
      const { blocks } = await getBlocksPaginated(
        page,
        limit,
        BigInt(fromBlock),
        BigInt(toBlock)
      );

      if (blocks.length === 0) break;

      for (const block of blocks) {
        const row: Record<string, unknown> = {};
        for (const field of validFields) {
          switch (field) {
            case 'block_number':
              row[field] = block.blockNumber.toString();
              break;
            case 'timestamp':
              row[field] = block.timestamp.toISOString();
              break;
            case 'gas_used':
              row[field] = block.gasUsed.toString();
              break;
            case 'gas_limit':
              row[field] = block.gasLimit.toString();
              break;
            case 'gas_used_percent':
              row[field] = Number(block.gasUsed * 100n / block.gasLimit);
              break;
            case 'base_fee_gwei':
              row[field] = block.baseFeeGwei;
              break;
            case 'avg_priority_fee_gwei':
              row[field] = block.avgPriorityFeeGwei;
              break;
            case 'min_priority_fee_gwei':
              row[field] = block.minPriorityFeeGwei;
              break;
            case 'max_priority_fee_gwei':
              row[field] = block.maxPriorityFeeGwei;
              break;
            case 'total_base_fee_gwei':
              row[field] = block.totalBaseFeeGwei;
              break;
            case 'total_priority_fee_gwei':
              row[field] = block.totalPriorityFeeGwei;
              break;
            case 'tx_count':
              row[field] = block.txCount;
              break;
            case 'block_time_sec':
              row[field] = block.blockTimeSec;
              break;
            case 'mgas_per_sec':
              row[field] = block.mgasPerSec;
              break;
            case 'tps':
              row[field] = block.tps;
              break;
            case 'finalized':
              row[field] = block.finalized;
              break;
            case 'time_to_finality_sec':
              row[field] = block.timeToFinalitySec;
              break;
          }
        }
        allBlocks.push(row);
      }

      if (blocks.length < limit) break;
      page++;
    }

    // Generate CSV
    const header = validFields.join(',');
    const rows = allBlocks.map((row) =>
      validFields.map((f) => row[f] ?? '').join(',')
    );
    const csv = [header, ...rows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="blocks_${fromBlock}_${toBlock}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting blocks:', error);
    return NextResponse.json(
      { error: 'Failed to export blocks' },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/export/route.ts
git commit -m "feat: add CSV export API endpoint"
```

---

## Phase 5: Background Workers

### Task 5.1: Create Live Poller Worker

**Files:**
- Create: `src/workers/livePoller.ts`

**Step 1: Create live poller**

```typescript
// src/workers/livePoller.ts
import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getHighestBlockNumber,
  getBlockByNumber,
  insertBlock
} from '@/lib/queries/blocks';
import { getLatestMilestone } from '@/lib/queries/milestones';
import { Block } from '@/lib/types';

const POLL_INTERVAL_MS = 2000;
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class LivePoller {
  private running = false;
  private lastProcessedBlock: bigint | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize from database
    this.lastProcessedBlock = await getHighestBlockNumber();
    console.log(`[LivePoller] Starting from block ${this.lastProcessedBlock?.toString() ?? 'none'}`);

    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.processNewBlocks();
        await this.sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[LivePoller] RPC exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[LivePoller] Error:', error);
          await this.sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async processNewBlocks(): Promise<void> {
    const rpc = getRpcClient();
    const latestBlockNumber = await rpc.getLatestBlockNumber();

    if (this.lastProcessedBlock === null) {
      this.lastProcessedBlock = latestBlockNumber - 1n;
    }

    // Process new blocks
    for (let blockNum = this.lastProcessedBlock + 1n; blockNum <= latestBlockNumber; blockNum++) {
      await this.processBlock(blockNum);
      this.lastProcessedBlock = blockNum;
    }
  }

  private async processBlock(blockNumber: bigint): Promise<void> {
    const rpc = getRpcClient();

    // Get block with transactions
    const block = await rpc.getBlockWithTransactions(blockNumber);

    // Get previous block timestamp for block time calculation
    let previousTimestamp: bigint | undefined;
    if (blockNumber > 0n) {
      const prevBlock = await getBlockByNumber(blockNumber - 1n);
      if (prevBlock) {
        previousTimestamp = BigInt(Math.floor(prevBlock.timestamp.getTime() / 1000));
      } else {
        const prevBlockRpc = await rpc.getBlock(blockNumber - 1n);
        previousTimestamp = prevBlockRpc.timestamp;
      }
    }

    // Calculate metrics
    const metrics = calculateBlockMetrics(block, previousTimestamp);

    // Check if block should be marked as finalized
    const latestMilestone = await getLatestMilestone();
    const finalized = latestMilestone ? blockNumber <= latestMilestone.endBlock : false;

    // Check for reorg
    const existingBlock = await getBlockByNumber(blockNumber);
    if (existingBlock && existingBlock.blockHash !== block.hash) {
      if (existingBlock.finalized) {
        console.error(`[LivePoller] Data discrepancy on finalized block ${blockNumber}! Skipping.`);
        return;
      }
      console.warn(`[LivePoller] Reorg detected at block ${blockNumber}, overwriting.`);
    }

    // Insert/update block
    const blockData: Omit<Block, 'createdAt' | 'updatedAt'> = {
      blockNumber,
      timestamp: new Date(Number(block.timestamp) * 1000),
      blockHash: block.hash,
      parentHash: block.parentHash,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeeGwei: metrics.baseFeeGwei,
      minPriorityFeeGwei: metrics.minPriorityFeeGwei,
      maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
      avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
      totalBaseFeeGwei: metrics.totalBaseFeeGwei,
      totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
      txCount: block.transactions.length,
      blockTimeSec: metrics.blockTimeSec,
      mgasPerSec: metrics.mgasPerSec,
      tps: metrics.tps,
      finalized,
      finalizedAt: finalized && latestMilestone ? latestMilestone.timestamp : null,
      milestoneId: finalized && latestMilestone ? latestMilestone.milestoneId : null,
      timeToFinalitySec: null,
    };

    await insertBlock(blockData);
    console.log(`[LivePoller] Processed block ${blockNumber}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Step 2: Commit**

```bash
git add src/workers/livePoller.ts
git commit -m "feat: add live poller worker"
```

---

### Task 5.2: Create Milestone Poller Worker

**Files:**
- Create: `src/workers/milestonePoller.ts`

**Step 1: Create milestone poller**

```typescript
// src/workers/milestonePoller.ts
import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import {
  getLatestMilestone,
  insertMilestone
} from '@/lib/queries/milestones';
import { updateBlocksFinalityInRange } from '@/lib/queries/blocks';

const POLL_INTERVAL_MS = 2500; // 2.5 seconds
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class MilestonePoller {
  private running = false;
  private lastMilestoneId: bigint | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize from database
    const latestMilestone = await getLatestMilestone();
    this.lastMilestoneId = latestMilestone?.milestoneId ?? null;
    console.log(`[MilestonePoller] Starting from milestone ${this.lastMilestoneId?.toString() ?? 'none'}`);

    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.checkNewMilestones();
        await this.sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof HeimdallExhaustedError) {
          console.error('[MilestonePoller] Heimdall exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[MilestonePoller] Error:', error);
          await this.sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async checkNewMilestones(): Promise<void> {
    const heimdall = getHeimdallClient();
    const latestMilestone = await heimdall.getLatestMilestone();

    if (this.lastMilestoneId === null || latestMilestone.milestoneId > this.lastMilestoneId) {
      // Process new milestone
      await this.processMilestone(latestMilestone);
      this.lastMilestoneId = latestMilestone.milestoneId;
    }
  }

  private async processMilestone(milestone: {
    milestoneId: bigint;
    startBlock: bigint;
    endBlock: bigint;
    hash: string;
    proposer: string | null;
    timestamp: Date;
  }): Promise<void> {
    // Store milestone
    await insertMilestone(milestone);

    // Update blocks in range
    const updatedCount = await updateBlocksFinalityInRange(
      milestone.startBlock,
      milestone.endBlock,
      milestone.milestoneId,
      milestone.timestamp
    );

    console.log(
      `[MilestonePoller] Milestone ${milestone.milestoneId}: blocks ${milestone.startBlock}-${milestone.endBlock}, updated ${updatedCount} blocks`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Step 2: Commit**

```bash
git add src/workers/milestonePoller.ts
git commit -m "feat: add milestone poller worker"
```

---

### Task 5.3: Create Backfiller Worker

**Files:**
- Create: `src/workers/backfiller.ts`

**Step 1: Create backfiller**

```typescript
// src/workers/backfiller.ts
import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { getHeimdallClient } from '@/lib/heimdall';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getLowestBlockNumber,
  insertBlocksBatch
} from '@/lib/queries/blocks';
import {
  getMilestoneForBlock,
  insertMilestone
} from '@/lib/queries/milestones';
import { Block } from '@/lib/types';

const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class Backfiller {
  private running = false;
  private targetBlock: bigint;
  private batchSize: number;
  private delayMs: number;

  constructor(targetBlock: bigint, batchSize = 100, delayMs = 100) {
    this.targetBlock = targetBlock;
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[Backfiller] Starting backfill to block ${this.targetBlock}`);
    await this.backfill();
  }

  stop(): void {
    this.running = false;
  }

  private async backfill(): Promise<void> {
    while (this.running) {
      try {
        const lowestBlock = await getLowestBlockNumber();

        if (lowestBlock === null) {
          // No blocks yet, wait for live poller to add some
          console.log('[Backfiller] No blocks in DB yet, waiting...');
          await this.sleep(5000);
          continue;
        }

        if (lowestBlock <= this.targetBlock) {
          console.log('[Backfiller] Backfill complete!');
          this.running = false;
          return;
        }

        await this.processBatch(lowestBlock);
        await this.sleep(this.delayMs);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[Backfiller] RPC exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Backfiller] Error:', error);
          await this.sleep(5000);
        }
      }
    }
  }

  private async processBatch(currentLowest: bigint): Promise<void> {
    const rpc = getRpcClient();
    const heimdall = getHeimdallClient();

    const startBlock = currentLowest - BigInt(this.batchSize);
    const endBlock = currentLowest - 1n;
    const targetStart = startBlock < this.targetBlock ? this.targetBlock : startBlock;

    console.log(`[Backfiller] Processing blocks ${targetStart} to ${endBlock}`);

    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    for (let blockNum = endBlock; blockNum >= targetStart; blockNum--) {
      const block = await rpc.getBlockWithTransactions(blockNum);

      // Get previous block for block time calculation
      let previousTimestamp: bigint | undefined;
      if (blockNum > 0n) {
        const prevBlock = await rpc.getBlock(blockNum - 1n);
        previousTimestamp = prevBlock.timestamp;
      }

      const metrics = calculateBlockMetrics(block, previousTimestamp);

      // Check milestone for finality
      let milestone = await getMilestoneForBlock(blockNum);
      if (!milestone) {
        // Try to fetch from Heimdall
        try {
          const latestMilestone = await heimdall.getLatestMilestone();
          if (blockNum <= latestMilestone.endBlock) {
            await insertMilestone(latestMilestone);
            milestone = latestMilestone;
          }
        } catch {
          // Milestone not available, continue without
        }
      }

      const finalized = milestone ? blockNum <= milestone.endBlock : false;
      let timeToFinalitySec: number | null = null;
      if (finalized && milestone) {
        const blockTime = new Date(Number(block.timestamp) * 1000);
        timeToFinalitySec = (milestone.timestamp.getTime() - blockTime.getTime()) / 1000;
      }

      blocks.push({
        blockNumber: blockNum,
        timestamp: new Date(Number(block.timestamp) * 1000),
        blockHash: block.hash,
        parentHash: block.parentHash,
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit,
        baseFeeGwei: metrics.baseFeeGwei,
        minPriorityFeeGwei: metrics.minPriorityFeeGwei,
        maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
        avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
        totalBaseFeeGwei: metrics.totalBaseFeeGwei,
        totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        txCount: block.transactions.length,
        blockTimeSec: metrics.blockTimeSec,
        mgasPerSec: metrics.mgasPerSec,
        tps: metrics.tps,
        finalized,
        finalizedAt: finalized && milestone ? milestone.timestamp : null,
        milestoneId: finalized && milestone ? milestone.milestoneId : null,
        timeToFinalitySec,
      });
    }

    await insertBlocksBatch(blocks);
    console.log(`[Backfiller] Inserted ${blocks.length} blocks`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Step 2: Commit**

```bash
git add src/workers/backfiller.ts
git commit -m "feat: add backfiller worker"
```

---

### Task 5.4: Create Worker Orchestrator

**Files:**
- Create: `src/workers/index.ts`

**Step 1: Create orchestrator**

```typescript
// src/workers/index.ts
import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';

let livePoller: LivePoller | null = null;
let milestonePoller: MilestonePoller | null = null;
let backfiller: Backfiller | null = null;

export async function startWorkers(): Promise<void> {
  const targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK ?? '50000000');
  const batchSize = parseInt(process.env.BACKFILL_BATCH_SIZE ?? '100', 10);
  const delayMs = parseInt(process.env.RPC_DELAY_MS ?? '100', 10);

  console.log('[Workers] Starting workers...');
  console.log(`[Workers] Backfill target: ${targetBlock}`);
  console.log(`[Workers] Batch size: ${batchSize}`);
  console.log(`[Workers] RPC delay: ${delayMs}ms`);

  // Start workers
  livePoller = new LivePoller();
  milestonePoller = new MilestonePoller();
  backfiller = new Backfiller(targetBlock, batchSize, delayMs);

  await Promise.all([
    livePoller.start(),
    milestonePoller.start(),
    backfiller.start(),
  ]);
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');
  livePoller?.stop();
  milestonePoller?.stop();
  backfiller?.stop();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  stopWorkers();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWorkers();
  process.exit(0);
});
```

**Step 2: Commit**

```bash
git add src/workers/index.ts
git commit -m "feat: add worker orchestrator"
```

---

## Phase 6: Frontend Components

### Task 6.1: Create Theme Provider

**Files:**
- Create: `src/components/ThemeProvider.tsx`
- Create: `src/components/ThemeToggle.tsx`

**Step 1: Create theme provider**

```typescript
// src/components/ThemeProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setTheme(stored);
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('light');
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
```

**Step 2: Create theme toggle**

```typescript
// src/components/ThemeToggle.tsx
'use client';

import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/ThemeProvider.tsx src/components/ThemeToggle.tsx
git commit -m "feat: add theme provider and toggle"
```

---

### Task 6.2: Create Block List Component

**Files:**
- Create: `src/components/blocks/BlockRow.tsx`
- Create: `src/components/blocks/BlockList.tsx`

**Step 1: Create block row**

```typescript
// src/components/blocks/BlockRow.tsx
'use client';

import { useState } from 'react';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  totalBaseFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface BlockRowProps {
  block: BlockData;
}

export function BlockRow({ block }: BlockRowProps) {
  const [expanded, setExpanded] = useState(false);

  const timeAgo = getTimeAgo(new Date(block.timestamp));
  const polygonscanUrl = `https://polygonscan.com/block/${block.blockNumber}`;

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <div
        className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4 flex-1">
          <a
            href={polygonscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline font-mono text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            #{block.blockNumber}
          </a>
          <span className="text-gray-500 text-sm">{timeAgo}</span>
          <span className="text-sm">{block.gasUsedPercent.toFixed(1)}%</span>
          <span className="text-sm font-medium">{block.baseFeeGwei.toFixed(2)} gwei</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            +{block.avgPriorityFeeGwei.toFixed(2)}
          </span>
          <span className="text-sm">{block.txCount} txs</span>
          {block.finalized ? (
            <span className="text-green-500 text-sm">
              ✓ {block.timeToFinalitySec?.toFixed(1)}s
            </span>
          ) : (
            <span className="text-yellow-500 text-sm">pending</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span className="text-gray-500">Min Priority:</span>{' '}
            {block.minPriorityFeeGwei.toFixed(4)} gwei
          </div>
          <div>
            <span className="text-gray-500">Max Priority:</span>{' '}
            {block.maxPriorityFeeGwei.toFixed(4)} gwei
          </div>
          <div>
            <span className="text-gray-500">Gas Used:</span>{' '}
            {formatNumber(parseInt(block.gasUsed, 10))}
          </div>
          <div>
            <span className="text-gray-500">Gas Limit:</span>{' '}
            {formatNumber(parseInt(block.gasLimit, 10))}
          </div>
          {block.totalBaseFeeGwei !== undefined && (
            <div>
              <span className="text-gray-500">Total Base Fee:</span>{' '}
              {block.totalBaseFeeGwei.toFixed(4)} gwei
            </div>
          )}
          {block.totalPriorityFeeGwei !== undefined && (
            <div>
              <span className="text-gray-500">Total Priority Fee:</span>{' '}
              {block.totalPriorityFeeGwei.toFixed(4)} gwei
            </div>
          )}
          <div className="col-span-2 md:col-span-4">
            <a
              href={polygonscanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              View on Polygonscan ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toString();
}
```

**Step 2: Create block list**

```typescript
// src/components/blocks/BlockList.tsx
'use client';

import { BlockRow } from './BlockRow';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  totalBaseFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface BlockListProps {
  blocks: BlockData[];
  title?: string;
}

export function BlockList({ blocks, title = 'Latest Blocks' }: BlockListProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {blocks.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No blocks found</div>
        ) : (
          blocks.map((block) => <BlockRow key={block.blockNumber} block={block} />)
        )}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/blocks/
git commit -m "feat: add block list components"
```

---

### Task 6.3: Create Mini Chart Component for Dashboard

**Files:**
- Create: `src/components/charts/MiniChart.tsx`

**Step 1: Create mini chart**

```typescript
// src/components/charts/MiniChart.tsx
'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';

interface MiniChartProps {
  title: string;
  data: { time: number; value: number }[];
  currentValue: string;
  unit: string;
  color?: string;
}

export function MiniChart({ title, data, currentValue, unit, color = '#2962FF' }: MiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 120,
      layout: {
        background: { color: 'transparent' },
        textColor: theme === 'dark' ? '#d1d5db' : '#374151',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
      },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addLineSeries({
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [theme, color]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      const chartData: LineData[] = data.map((d) => ({
        time: d.time as number,
        value: d.value,
      }));
      seriesRef.current.setData(chartData);
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</h3>
        <div className="text-right">
          <span className="text-xl font-bold">{currentValue}</span>
          <span className="text-sm text-gray-500 ml-1">{unit}</span>
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/MiniChart.tsx
git commit -m "feat: add mini chart component for dashboard"
```

---

### Task 6.4: Create Full Chart Component for Analytics

**Files:**
- Create: `src/components/charts/FullChart.tsx`
- Create: `src/components/charts/ChartControls.tsx`

**Step 1: Create chart controls**

```typescript
// src/components/charts/ChartControls.tsx
'use client';

interface ChartControlsProps {
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  bucketSize: string;
  onBucketSizeChange: (size: string) => void;
  chartType: string;
  onChartTypeChange: (type: string) => void;
  seriesOptions: { key: string; label: string; enabled: boolean }[];
  onSeriesToggle: (key: string) => void;
}

const TIME_RANGES = ['1H', '6H', '1D', '1W', '1M', '6M', '1Y', 'ALL'];
const BUCKET_SIZES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const CHART_TYPES = ['Line', 'Candle', 'Area', 'Bar'];

export function ChartControls({
  timeRange,
  onTimeRangeChange,
  bucketSize,
  onBucketSizeChange,
  chartType,
  onChartTypeChange,
  seriesOptions,
  onSeriesToggle,
}: ChartControlsProps) {
  return (
    <div className="flex flex-wrap gap-4 items-center text-sm">
      <div className="flex gap-1">
        {TIME_RANGES.map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            className={`px-2 py-1 rounded ${
              timeRange === range
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      <select
        value={bucketSize}
        onChange={(e) => onBucketSizeChange(e.target.value)}
        className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700"
      >
        {BUCKET_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <select
        value={chartType}
        onChange={(e) => onChartTypeChange(e.target.value)}
        className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700"
      >
        {CHART_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <div className="flex gap-2">
        {seriesOptions.map((option) => (
          <label key={option.key} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={option.enabled}
              onChange={() => onSeriesToggle(option.key)}
              className="rounded"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Create full chart**

```typescript
// src/components/charts/FullChart.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, CandlestickData } from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartControls } from './ChartControls';

interface ChartDataPoint {
  timestamp: number;
  blockStart: number;
  blockEnd: number;
  baseFee: { open: number; high: number; low: number; close: number; avg: number };
  priorityFee: { avg: number; min: number; max: number };
  total: { avg: number; min: number; max: number };
  mgasPerSec: number;
  tps: number;
  finalityAvg: number | null;
}

interface FullChartProps {
  title: string;
  metric: 'gas' | 'finality' | 'mgas' | 'tps';
}

export function FullChart({ title, metric }: FullChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<'Line' | 'Candlestick'>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1H');
  const [bucketSize, setBucketSize] = useState('1m');
  const [chartType, setChartType] = useState('Line');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  const [seriesOptions, setSeriesOptions] = useState(() => {
    if (metric === 'gas') {
      return [
        { key: 'base', label: 'Base', enabled: true },
        { key: 'avgPriority', label: 'Avg Priority', enabled: true },
        { key: 'total', label: 'Total', enabled: true },
        { key: 'minPriority', label: 'Min Priority', enabled: false },
        { key: 'maxPriority', label: 'Max Priority', enabled: false },
      ];
    }
    return [
      { key: 'avg', label: 'Avg', enabled: true },
      { key: 'min', label: 'Min', enabled: false },
      { key: 'max', label: 'Max', enabled: false },
    ];
  });

  const fetchData = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    let fromTime: number;

    switch (timeRange) {
      case '1H': fromTime = now - 3600; break;
      case '6H': fromTime = now - 6 * 3600; break;
      case '1D': fromTime = now - 86400; break;
      case '1W': fromTime = now - 7 * 86400; break;
      case '1M': fromTime = now - 30 * 86400; break;
      case '6M': fromTime = now - 180 * 86400; break;
      case '1Y': fromTime = now - 365 * 86400; break;
      default: fromTime = 0;
    }

    const response = await fetch(
      `/api/chart-data?fromTime=${fromTime}&toTime=${now}&bucketSize=${bucketSize}`
    );
    const json = await response.json();
    setData(json.data || []);
  }, [timeRange, bucketSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { color: 'transparent' },
        textColor: theme === 'dark' ? '#d1d5db' : '#374151',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
        horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [theme]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    const colors = ['#2962FF', '#FF6D00', '#00C853', '#AA00FF', '#FF1744'];

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt, index) => {
        const color = colors[index % colors.length];
        let seriesData: LineData[] | CandlestickData[];

        if (metric === 'gas') {
          seriesData = data.map((d) => {
            const value =
              opt.key === 'base' ? d.baseFee.avg :
              opt.key === 'avgPriority' ? d.priorityFee.avg :
              opt.key === 'total' ? d.total.avg :
              opt.key === 'minPriority' ? d.priorityFee.min :
              d.priorityFee.max;
            return { time: d.timestamp as number, value };
          });
        } else if (metric === 'finality') {
          seriesData = data
            .filter((d) => d.finalityAvg !== null)
            .map((d) => ({ time: d.timestamp as number, value: d.finalityAvg! }));
        } else if (metric === 'mgas') {
          seriesData = data.map((d) => ({ time: d.timestamp as number, value: d.mgasPerSec }));
        } else {
          seriesData = data.map((d) => ({ time: d.timestamp as number, value: d.tps }));
        }

        const series = chartRef.current!.addLineSeries({
          color,
          lineWidth: 2,
          title: opt.label,
        });
        series.setData(seriesData as LineData[]);
        seriesRefs.current.set(opt.key, series);
      });

    chartRef.current.timeScale().fitContent();
  }, [data, seriesOptions, metric, chartType]);

  const handleSeriesToggle = (key: string) => {
    setSeriesOptions((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        chartType={chartType}
        onChartTypeChange={setChartType}
        seriesOptions={seriesOptions}
        onSeriesToggle={handleSeriesToggle}
      />
      <div ref={chartContainerRef} className="w-full mt-4" />
      {hoverInfo && <div className="text-sm text-gray-500 mt-2">{hoverInfo}</div>}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/charts/ChartControls.tsx src/components/charts/FullChart.tsx
git commit -m "feat: add full chart component with controls"
```

---

## Phase 7: Pages & Final Integration

### Task 7.1: Update Layout

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Step 1: Update layout**

```typescript
// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Polygon Dashboard',
  description: 'Real-time Polygon blockchain gas tracker and analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Step 2: Update globals.css**

```css
/* src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 243, 244, 246;
  --background-end-rgb: 243, 244, 246;
}

.dark {
  --foreground-rgb: 255, 255, 255;
  --background-start-rgb: 3, 7, 18;
  --background-end-rgb: 3, 7, 18;
}
```

**Step 3: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat: update layout with theme provider"
```

---

### Task 7.2: Create Homepage

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Create homepage**

```typescript
// src/app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MiniChart } from '@/components/charts/MiniChart';
import { BlockList } from '@/components/blocks/BlockList';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

export default function Home() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlocks = async () => {
      try {
        const response = await fetch('/api/blocks/latest');
        const data = await response.json();
        setBlocks(data.blocks || []);
      } catch (error) {
        console.error('Failed to fetch blocks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBlocks();
    const interval = setInterval(fetchBlocks, 2000);
    return () => clearInterval(interval);
  }, []);

  const latestBlock = blocks[0];
  const chartData = blocks
    .slice()
    .reverse()
    .map((b, i) => ({ time: i, value: b.baseFeeGwei }));

  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Polygon Dashboard</h1>
          <div className="flex items-center gap-4">
            <Link href="/analytics" className="text-blue-500 hover:underline">
              Analytics
            </Link>
            <Link href="/blocks" className="text-blue-500 hover:underline">
              Blocks
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MiniChart
            title="Gas Price"
            data={chartData}
            currentValue={latestBlock?.baseFeeGwei.toFixed(2) ?? '-'}
            unit="gwei"
            color="#2962FF"
          />
          <MiniChart
            title="Finality Delay"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.timeToFinalitySec ?? 0 }))}
            currentValue={latestBlock?.timeToFinalitySec?.toFixed(1) ?? '-'}
            unit="sec"
            color="#FF6D00"
          />
          <MiniChart
            title="MGAS/s"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.mgasPerSec ?? 0 }))}
            currentValue={latestBlock?.mgasPerSec?.toFixed(1) ?? '-'}
            unit=""
            color="#00C853"
          />
          <MiniChart
            title="TPS"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.tps ?? 0 }))}
            currentValue={latestBlock?.tps?.toFixed(0) ?? '-'}
            unit=""
            color="#AA00FF"
          />
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <BlockList blocks={blocks} title="Latest Blocks (Live)" />
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: create homepage with live dashboard"
```

---

### Task 7.3: Create Analytics Page

**Files:**
- Create: `src/app/analytics/page.tsx`

**Step 1: Create analytics page**

```typescript
// src/app/analytics/page.tsx
'use client';

import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FullChart } from '@/components/charts/FullChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-500 hover:underline">
              ← Home
            </Link>
            <h1 className="text-xl font-bold">Historic Analytics</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <FullChart title="Gas Price" metric="gas" />
        <FullChart title="Finality Delay" metric="finality" />
        <FullChart title="MGAS/s" metric="mgas" />
        <FullChart title="TPS" metric="tps" />

        <div className="flex justify-center gap-4">
          <Link href="/blocks" className="text-blue-500 hover:underline">
            View Block Details →
          </Link>
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/analytics/page.tsx
git commit -m "feat: create analytics page with full charts"
```

---

### Task 7.4: Create Blocks Page

**Files:**
- Create: `src/app/blocks/page.tsx`

**Step 1: Create blocks page**

```typescript
// src/app/blocks/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BlockList } from '@/components/blocks/BlockList';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function BlocksPage() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpToBlock, setJumpToBlock] = useState('');
  const [page, setPage] = useState(1);

  const fetchBlocks = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/blocks?page=${pageNum}&limit=50`);
      const data = await response.json();
      setBlocks(data.blocks || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch blocks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlocks(page);
  }, [page, fetchBlocks]);

  const handleJumpToBlock = async () => {
    if (!jumpToBlock) return;
    const blockNum = parseInt(jumpToBlock, 10);
    if (isNaN(blockNum)) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/blocks?fromBlock=${blockNum}&toBlock=${blockNum}&limit=1`);
      const data = await response.json();
      if (data.blocks?.length > 0) {
        // Calculate which page this block is on
        const total = data.pagination?.total || 0;
        const pageNum = Math.ceil((total - blockNum + parseInt(data.blocks[0].blockNumber)) / 50);
        setPage(Math.max(1, pageNum));
      }
    } catch (error) {
      console.error('Failed to jump to block:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-500 hover:underline">
              ← Home
            </Link>
            <h1 className="text-xl font-bold">Historic Blocks</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-4 mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={jumpToBlock}
              onChange={(e) => setJumpToBlock(e.target.value)}
              placeholder="Block number"
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
            />
            <button
              onClick={handleJumpToBlock}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Go
            </button>
          </div>
          <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            Export CSV
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <>
            <BlockList blocks={blocks} title="Historic Blocks" />

            {pagination && (
              <div className="flex justify-center items-center gap-4 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span>
                  Page {pagination.page} of {pagination.totalPages.toLocaleString()}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/blocks/page.tsx
git commit -m "feat: create historic blocks page with pagination"
```

---

### Task 7.5: Create Component Index Files

**Files:**
- Create: `src/components/index.ts`
- Create: `src/components/charts/index.ts`
- Create: `src/components/blocks/index.ts`

**Step 1: Create index files**

```typescript
// src/components/index.ts
export * from './ThemeProvider';
export * from './ThemeToggle';

// src/components/charts/index.ts
export * from './MiniChart';
export * from './FullChart';
export * from './ChartControls';

// src/components/blocks/index.ts
export * from './BlockList';
export * from './BlockRow';
```

**Step 2: Commit**

```bash
git add src/components/index.ts src/components/charts/index.ts src/components/blocks/index.ts
git commit -m "feat: add component index files"
```

---

### Task 7.6: Start Workers on Server Startup

**Files:**
- Create: `src/app/api/workers/start/route.ts`
- Modify: `src/app/layout.tsx` (add worker initialization)

**Step 1: Create workers start endpoint**

```typescript
// src/app/api/workers/start/route.ts
import { NextResponse } from 'next/server';
import { startWorkers } from '@/workers';

let started = false;

export async function POST() {
  if (started) {
    return NextResponse.json({ message: 'Workers already started' });
  }

  try {
    await startWorkers();
    started = true;
    return NextResponse.json({ message: 'Workers started' });
  } catch (error) {
    console.error('Failed to start workers:', error);
    return NextResponse.json({ error: 'Failed to start workers' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/workers/start/route.ts
git commit -m "feat: add workers start endpoint"
```

---

### Task 7.7: Final Integration & Testing

**Step 1: Start database**

```bash
docker compose up -d db
```

Expected: TimescaleDB container starts

**Step 2: Verify database schema**

```bash
docker exec -it gas-fees-graph-db-1 psql -U polygon -d polygon_dashboard -c "\dt"
```

Expected: Shows blocks and milestones tables

**Step 3: Start development server**

```bash
npm run dev
```

Expected: Server starts on http://localhost:3000

**Step 4: Test API endpoints**

```bash
curl http://localhost:3000/api/blocks/latest
```

Expected: Returns JSON with empty blocks array initially

**Step 5: Start workers (via API or direct)**

```bash
curl -X POST http://localhost:3000/api/workers/start
```

Expected: Workers start polling

**Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete Polygon Dashboard implementation"
```

---

## Execution Summary

**Total Phases:** 7
**Total Tasks:** 27

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 5 | Project setup & infrastructure |
| 2 | 3 | RPC & Heimdall clients |
| 3 | 4 | Database queries |
| 4 | 4 | API routes |
| 5 | 4 | Background workers |
| 6 | 4 | Frontend components |
| 7 | 7 | Pages & integration |

---

Plan complete and saved to `docs/plans/2026-01-09-polygon-dashboard-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
