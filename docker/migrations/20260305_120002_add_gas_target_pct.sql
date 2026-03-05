-- Migration: Add gas_target_pct column to blocks table

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS gas_target_pct DOUBLE PRECISION;
