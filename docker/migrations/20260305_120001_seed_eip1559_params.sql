-- Migration: Seed eip1559_params with known hardfork BFCD values

INSERT INTO eip1559_params (block_number, base_fee_change_denominator, description) VALUES
  (23850000, 8, 'London hardfork - EIP-1559 activation'),
  (38189056, 16, 'Delhi hardfork - PIP-6'),
  (73440256, 64, 'Bhilai hardfork - PIP-58')
ON CONFLICT (block_number) DO NOTHING;
