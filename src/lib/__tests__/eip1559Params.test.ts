import { getBfcdForBlock, getDefaultGasTargetPct, Eip1559Param } from '../eip1559Params';

const PARAMS: Eip1559Param[] = [
  { blockNumber: 23850000n, baseFeeChangeDenominator: 8 },
  { blockNumber: 38189056n, baseFeeChangeDenominator: 16 },
  { blockNumber: 73440256n, baseFeeChangeDenominator: 64 },
];

describe('getBfcdForBlock', () => {
  it('returns null for empty params', () => {
    expect(getBfcdForBlock(50000000n, [])).toBeNull();
  });

  it('returns null for block before first param', () => {
    expect(getBfcdForBlock(23849999n, PARAMS)).toBeNull();
  });

  it('returns first BFCD at exact activation block', () => {
    expect(getBfcdForBlock(23850000n, PARAMS)).toBe(8);
  });

  it('returns first BFCD for block between first and second', () => {
    expect(getBfcdForBlock(30000000n, PARAMS)).toBe(8);
  });

  it('returns second BFCD at exact Delhi activation', () => {
    expect(getBfcdForBlock(38189056n, PARAMS)).toBe(16);
  });

  it('returns second BFCD between Delhi and Bhilai', () => {
    expect(getBfcdForBlock(50000000n, PARAMS)).toBe(16);
  });

  it('returns third BFCD at exact Bhilai activation', () => {
    expect(getBfcdForBlock(73440256n, PARAMS)).toBe(64);
  });

  it('returns latest BFCD for blocks well past last hardfork', () => {
    expect(getBfcdForBlock(90000000n, PARAMS)).toBe(64);
  });

  it('returns correct BFCD one block before hardfork', () => {
    expect(getBfcdForBlock(38189055n, PARAMS)).toBe(8);
    expect(getBfcdForBlock(73440255n, PARAMS)).toBe(16);
  });

  it('handles single-element params', () => {
    const single: Eip1559Param[] = [{ blockNumber: 100n, baseFeeChangeDenominator: 8 }];
    expect(getBfcdForBlock(99n, single)).toBeNull();
    expect(getBfcdForBlock(100n, single)).toBe(8);
    expect(getBfcdForBlock(999n, single)).toBe(8);
  });
});

describe('getDefaultGasTargetPct', () => {
  it('returns 50% for blocks before Dandeli', () => {
    expect(getDefaultGasTargetPct(81423999n)).toBe(50);
    expect(getDefaultGasTargetPct(50000000n)).toBe(50);
  });

  it('returns 65% for Dandeli activation block and after', () => {
    expect(getDefaultGasTargetPct(81424000n)).toBe(65);
    expect(getDefaultGasTargetPct(90000000n)).toBe(65);
  });
});
