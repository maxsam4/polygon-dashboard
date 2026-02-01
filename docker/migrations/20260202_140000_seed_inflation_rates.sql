-- Migration: Seed inflation_rates with known POL emission rate changes
-- Values verified via archive node queries from Ethereum mainnet

INSERT INTO inflation_rates (
  block_number,
  block_timestamp,
  interest_per_year_log2,
  start_supply,
  start_timestamp
) VALUES
  -- Period 1: Initial POL deployment (Oct 25, 2023)
  (18426253, '2023-10-25T09:06:23Z', 42644337408493720, 10000000000000000000000000000, 1698224783),
  -- Period 2: First rate reduction (Sep 4, 2024)
  (20678332, '2024-09-04T16:11:59Z', 35623909730721220, 10248739753465028590240000886, 1725466319),
  -- Period 3: Second rate reduction (Jul 9, 2025)
  (22884776, '2025-07-09T23:03:59Z', 28569152196770890, 10466456329199769051012729173, 1752102239)
ON CONFLICT (block_number) DO NOTHING;
