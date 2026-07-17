-- POL/MATIC hourly USD price series (Binance klines: MATICUSDT until 2024-09-10,
-- POLUSDT from 2024-09-13, 1:1 swap; gap hours filled by carry-forward).
-- Plain table (~53K rows) - hypertable overhead unjustified.
-- Gap-free guarantee: PriceIndexer backfill + carry-forward ensures every hour from
-- PRICE_HISTORY_START to now has a row, so chart/stats joins can treat a missing row
-- as "before price history / fetcher outage" only.

CREATE TABLE IF NOT EXISTS pol_prices (
  ts TIMESTAMPTZ PRIMARY KEY,          -- hour start (kline openTime, always :00:00 UTC)
  price_usd DOUBLE PRECISION NOT NULL, -- hourly close
  source TEXT NOT NULL,                -- 'binance:MATICUSDT' | 'binance:POLUSDT' | 'carry_forward'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
