-- Add 'priority_fee' as a valid gap type for blocks with missing priority fee data
-- This allows GapAnalyzer to detect and Gapfiller to fill blocks with null avg/total priority fees

-- Drop the old constraint
ALTER TABLE gaps DROP CONSTRAINT IF EXISTS gaps_valid_type;

-- Add the new constraint with priority_fee included
ALTER TABLE gaps ADD CONSTRAINT gaps_valid_type
  CHECK (gap_type IN ('block', 'milestone', 'finality', 'priority_fee'));
