-- Migration: Remove unused implementation_address column from inflation_rates
ALTER TABLE inflation_rates DROP COLUMN IF EXISTS implementation_address;
