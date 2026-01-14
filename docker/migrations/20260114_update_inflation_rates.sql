-- Migration: Update inflation_rates with correct on-chain values
-- This fixes the compound interest bug by using actual totalSupply at each upgrade block
-- All values verified via archive node queries from Ethereum mainnet

-- Update Period 1 (Oct 25, 2023) - Correct timestamp
UPDATE inflation_rates
SET block_timestamp = '2023-10-25T09:06:23Z',
    start_timestamp = 1698224783
WHERE block_number = 18426253;

-- Update Period 2 (Sep 4, 2024) - Correct timestamp and ACTUAL on-chain totalSupply
UPDATE inflation_rates
SET block_timestamp = '2024-09-04T16:11:59Z',
    start_supply = 10248739753465028590240000886,
    start_timestamp = 1725466319
WHERE block_number = 20678332;

-- Update Period 3 (Jul 9, 2025) - Correct timestamp and ACTUAL on-chain totalSupply
UPDATE inflation_rates
SET block_timestamp = '2025-07-09T23:03:59Z',
    start_supply = 10466456329199769051012729173,
    start_timestamp = 1752102239
WHERE block_number = 22884776;

-- Verify the updates
SELECT
  block_number,
  block_timestamp,
  start_timestamp,
  start_supply::text AS start_supply,
  interest_per_year_log2
FROM inflation_rates
ORDER BY block_timestamp;
